//! Sa hình liên hoàn: the 11 bài driven in one run.
//!
//! The run holds **one unchanged per-bài [`Session`] at a time** and starts the next when the
//! current one reaches `Done`. Every bài is therefore judged by the code, the geometry and the
//! ruleset rows it has on its own page; this file adds only what belongs to the run as a whole:
//! the course clock, the cumulative score, the verdict, where the run ends, and the one stretch
//! outside the bài — the link — with its hazard and its wrong-place stops.
//!
//! What a swap does (`assumptions.lien_hoan_chain`): the next stage starts exactly as its own page
//! starts it — the car at that stage's start pose, at rest, engine running. Nothing of the previous
//! stage's car is carried, because no bài's judgement reads it.
//!
//! The run ends on the tick a bài is suspended (`Penalty::Disqualify`, B.I.1.4 and the per-bài
//! rows), or when bài 11 is done. After bài 11 a score under `scoring.pass` is `SH.KT.DUOI_80`.

use crate::hash::Hash;
use crate::rules::{Penalty, Ruleset};
use crate::{AUTOMATIC_BIT, DT, EXERCISE_SHIFT, Event, LINK_ID, Prng, Session, TickInput};

/// The exercise id of the whole run (top byte of the seed).
pub const LIEN_HOAN_ID: u64 = 12;
/// How many bài the run drives.
pub const LESSONS: u8 = 11;

/// Bits 0..54 of the seed word: the seed proper, shared by every bài of the run.
const SEED_LOW: u64 = AUTOMATIC_BIT - 1;

/// Snapshot field 56: where the run stands.
pub const VERDICT_RUNNING: f64 = 0.0;
pub const VERDICT_PASSED: f64 = 1.0;
pub const VERDICT_FAILED: f64 = 2.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Stage {
    Bai(u8),
    Link,
}

/// The order of the run. The link sits between bài 6 and bài 7 (`assumptions.lien_hoan_link`).
const ORDER: [Stage; 12] = [
    Stage::Bai(1),
    Stage::Bai(2),
    Stage::Bai(3),
    Stage::Bai(4),
    Stage::Bai(5),
    Stage::Bai(6),
    Stage::Link,
    Stage::Bai(7),
    Stage::Bai(8),
    Stage::Bai(9),
    Stage::Bai(10),
    Stage::Bai(11),
];

/// The hazard of the link, in the link's own ticks: `t0` is the tick the signal began.
#[derive(Default)]
struct Hazard {
    t0: Option<u32>,
    /// Ticks after `t0` at which the car was first stopped / the button was first down.
    stopped_at: Option<u32>,
    lamp_at: Option<u32>,
    /// PHANH and BAT_TIN_HIEU have been judged (at 5 s); TAT_TIN_HIEU has (the car went on).
    reacted: bool,
    resolved: bool,
}

pub struct Chain {
    rules: Ruleset,
    seed: u64,
    inner: Session,
    /// Index into [`ORDER`].
    at: usize,
    /// Steps since bài 1's start order (the first scored step is 1). 0 while the run waits for it.
    tick: u32,
    score: i32,
    time_charges: u32,
    suspended: bool,
    finished: bool,
    events: Vec<Event>,
    pending: Vec<Event>,
    /// Where on the link (front bumper, metres) the hazard begins: drawn once from the seed.
    hazard_at_m: f64,
    hazard: Hazard,
    /// The hazard button as the last input held it.
    lamp: bool,
    /// The car was moving on the previous link step, so speed 0 now is a stop.
    link_moving: bool,
}

impl Chain {
    pub fn new(seed: u64, rules: Ruleset) -> Self {
        let inner = Self::open(seed, ORDER[0], &rules);
        let lh = &rules.lien_hoan;
        let mut rng = Prng(seed ^ 0x6c62_272e_07bb_0142);
        let hazard_at_m = lh.hazard_min_m + (rng.next() % 1001) as f64 / 1000.0 * (lh.hazard_max_m - lh.hazard_min_m);
        Self {
            score: rules.scoring.base,
            rules,
            seed,
            inner,
            at: 0,
            tick: 0,
            time_charges: 0,
            suspended: false,
            finished: false,
            events: Vec::new(),
            pending: Vec::new(),
            hazard_at_m,
            hazard: Hazard::default(),
            lamp: false,
            link_moving: false,
        }
    }

    /// The seed word of the per-bài session for `lesson`: the run's seed with the exercise id swapped
    /// for the bài's. It is the word that bài's own page runs on.
    pub(crate) fn bai_seed(seed: u64, lesson: u8) -> u64 {
        Self::stage_seed(seed, u64::from(lesson))
    }

    fn stage_seed(seed: u64, id: u64) -> u64 {
        (id << EXERCISE_SHIFT) | (seed & (SEED_LOW | AUTOMATIC_BIT))
    }

    fn open(seed: u64, stage: Stage, rules: &Ruleset) -> Session {
        let id = match stage {
            Stage::Bai(k) => u64::from(k),
            Stage::Link => LINK_ID,
        };
        Session::with_ruleset(Self::stage_seed(seed, id), rules.clone()).expect("every stage is an exercise of the core")
    }

    /// A run that begins on the link, for the tests of the link alone. The clock is running, as it
    /// would be by then.
    #[cfg(test)]
    pub(crate) fn on_link_for_test(seed: u64, rules: Ruleset) -> Self {
        let mut c = Self::new(seed, rules);
        c.at = ORDER.iter().position(|s| *s == Stage::Link).expect("the link is in the order");
        c.inner = Self::open(seed, Stage::Link, &c.rules);
        c.tick = 1;
        c
    }

    pub fn step(&mut self, input: TickInput) {
        if self.finished {
            return;
        }
        self.inner.step(input);
        if self.tick > 0 || self.inner.view().tick > 0 {
            self.tick += 1;
        }
        for e in self.inner.drain_events() {
            self.score -= i32::from(e.points);
            self.push(e.code, e.points);
        }
        let done = self.inner.view().phase == crate::Phase::Done;
        if ORDER[self.at] == Stage::Link {
            self.on_link(input.flags & TickInput::FLAG_HAZARD != 0, done);
        }
        self.charge_time();

        if !done || self.finished {
            return;
        }
        if self.inner.view().disqualified {
            self.suspended = true;
            self.finished = true;
        } else if self.at + 1 == ORDER.len() {
            if self.score < self.rules.scoring.pass {
                self.charge("SH.KT.DUOI_80");
            }
            self.finished = true;
        } else {
            self.at += 1;
            self.inner = Self::open(self.seed, ORDER[self.at], &self.rules);
        }
    }

    /// What the run judges on the link, after the link's own session has stepped: a stop away from
    /// the hazard (`SH.CHUNG.DUNG_SAI_VI_TRI`) and what the learner does about the hazard
    /// (`SH.CHUNG.NGUY_HIEM.*`, `assumptions.lien_hoan_hazard`).
    fn on_link(&mut self, lamp: bool, done: bool) {
        let (tick, speed, bumper, engine) = {
            let v = self.inner.view();
            (v.tick, v.speed_mps, v.front_bumper_m, v.engine_on)
        };
        self.lamp = lamp;

        // A stop with the engine running, while no hazard is being dealt with.
        let hazard_open = self.hazard.t0.is_some() && !self.hazard.resolved;
        if self.link_moving && speed <= 0.0 && engine && !hazard_open {
            self.charge("SH.CHUNG.DUNG_SAI_VI_TRI");
        }
        self.link_moving = speed > 0.0;

        if self.hazard.t0.is_none() && bumper >= self.hazard_at_m {
            self.hazard.t0 = Some(tick);
        }
        let Some(t0) = self.hazard.t0 else { return };
        let since = tick - t0;
        let ticks = |s: f64| (s / DT).round() as u32;
        if self.hazard.stopped_at.is_none() && speed <= 0.0 {
            self.hazard.stopped_at = Some(since);
        }
        if self.hazard.lamp_at.is_none() && lamp {
            self.hazard.lamp_at = Some(since);
        }
        if !self.hazard.reacted && (since >= ticks(5.0) || done) {
            self.judge_reaction(ticks(3.0), ticks(5.0));
        }
        let over = since >= ticks(self.rules.lien_hoan.hazard_signal_s);
        if !self.hazard.resolved && ((over && speed > 0.1) || done) {
            // The car goes on (or the link ends): the button must be up by now.
            if self.lamp {
                self.charge("SH.CHUNG.NGUY_HIEM.TAT_TIN_HIEU");
            }
            self.hazard.resolved = true;
        }
    }

    /// PHANH and BAT_TIN_HIEU, judged together at 5 s so that doing neither is one KHONG_THUC_HIEN
    /// and not both rows on top of it.
    fn judge_reaction(&mut self, brake_ticks: u32, lamp_ticks: u32) {
        self.hazard.reacted = true;
        let braked = self.hazard.stopped_at.is_some_and(|t| t <= brake_ticks);
        let pressed = self.hazard.lamp_at.is_some_and(|t| t <= lamp_ticks);
        match (braked, pressed) {
            (false, false) => self.charge("SH.CHUNG.NGUY_HIEM.KHONG_THUC_HIEN"),
            (braked, pressed) => {
                if !braked {
                    self.charge("SH.CHUNG.NGUY_HIEM.PHANH");
                }
                if !pressed {
                    self.charge("SH.CHUNG.NGUY_HIEM.BAT_TIN_HIEU");
                }
            }
        }
    }

    /// `SH.KT.TONG_THOI_GIAN`: −1 for each whole 3 s past the time limit, on the run's own clock.
    fn charge_time(&mut self) {
        let limit = (self.rules.lien_hoan.time_limit_s / DT).round() as u32;
        let every = (self.rules.rule("SH.KT.TONG_THOI_GIAN").params.seconds / DT).round() as u32;
        if self.tick > limit && (self.tick - limit) % every == 0 {
            self.time_charges += 1;
            self.charge("SH.KT.TONG_THOI_GIAN");
        }
    }

    /// Charge a run-level rule: its row decides the points or the suspension.
    fn charge(&mut self, id: &str) {
        let rule = self.rules.rule(id);
        let code = rule.code;
        let points = match rule.penalty {
            Penalty::Points { points } => points,
            Penalty::Disqualify => {
                self.suspended = true;
                self.finished = true;
                0
            }
        };
        self.score -= i32::from(points);
        self.push(code, points);
    }

    fn push(&mut self, code: u16, points: i16) {
        let event = Event { tick: self.tick, code, points };
        self.events.push(event);
        self.pending.push(event);
    }

    pub fn drain_events(&mut self) -> Vec<Event> {
        core::mem::take(&mut self.pending)
    }

    pub fn verdict(&self) -> f64 {
        if !self.finished {
            VERDICT_RUNNING
        } else if self.suspended {
            VERDICT_FAILED
        } else {
            VERDICT_PASSED
        }
    }

    pub fn hash(&self) -> u64 {
        let mut h = Hash::new();
        h.u64(self.seed);
        h.u32(self.at as u32);
        h.u32(self.tick);
        h.i32(self.score);
        h.u32(self.time_charges);
        h.bool(self.suspended);
        h.bool(self.finished);
        h.u64(self.inner.hash());
        let z = &self.hazard;
        h.opt_f64(z.t0.map(f64::from));
        h.opt_f64(z.stopped_at.map(f64::from));
        h.opt_f64(z.lamp_at.map(f64::from));
        h.bool(z.reacted);
        h.bool(z.resolved);
        h.bool(self.lamp);
        h.bool(self.link_moving);
        h.u32(self.events.len() as u32);
        for e in &self.events {
            h.u32(e.tick);
            h.u16(e.code);
            h.i16(e.points);
        }
        h.raw()
    }

    /// The current stage's snapshot, so a page written for one bài reads the run unchanged; only the
    /// score and the suspension are the run's, and fields 54.. say where the run is.
    ///
    /// 57 on the link (0 | 1); 58 the hazard: 0 not yet | 1 the signal sounds | 2 the signal has ended
    /// and the car has not gone on | 3 over; 59 ms since the signal began; 60 the button is down.
    pub fn snapshot(&self) -> crate::Snapshot {
        let mut out = self.inner.snapshot();
        out[2] = f64::from(self.score);
        out[3] = f64::from(u8::from(self.suspended));
        out[54] = f64::from(self.lesson());
        out[55] = f64::from(self.tick);
        out[56] = self.verdict();
        out[57] = f64::from(u8::from(ORDER[self.at] == Stage::Link));
        if let Some(t0) = self.hazard.t0 {
            let since = self.inner.view().tick.saturating_sub(t0);
            let signal = (self.rules.lien_hoan.hazard_signal_s / DT).round() as u32;
            out[58] = if self.hazard.resolved {
                3.0
            } else if since < signal {
                1.0
            } else {
                2.0
            };
            out[59] = f64::from(since) * DT * 1000.0;
        }
        out[60] = f64::from(u8::from(self.lamp));
        out
    }

    pub fn course_block(&self) -> Vec<f64> {
        self.inner.course_block()
    }

    /// The bài being driven, 1..=11; 0 on the link.
    #[doc(hidden)]
    pub fn lesson(&self) -> u8 {
        match ORDER[self.at] {
            Stage::Bai(k) => k,
            Stage::Link => 0,
        }
    }

    #[doc(hidden)]
    pub fn hazard_at_for_test(&self) -> f64 {
        self.hazard_at_m
    }

    #[doc(hidden)]
    pub fn on_the_link(&self) -> bool {
        ORDER[self.at] == Stage::Link
    }

    #[doc(hidden)]
    pub fn score(&self) -> i32 {
        self.score
    }

    #[doc(hidden)]
    pub fn events(&self) -> &[Event] {
        &self.events
    }

    #[doc(hidden)]
    pub fn inner(&self) -> &Session {
        &self.inner
    }

    #[doc(hidden)]
    pub fn rules(&self) -> &Ruleset {
        &self.rules
    }
}
