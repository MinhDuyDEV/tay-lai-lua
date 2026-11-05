//! Sa hình liên hoàn: the 11 bài driven in one run.
//!
//! The run holds **one unchanged per-bài [`Session`] at a time** and starts the next when the
//! current one reaches `Done`. Every bài is therefore judged by the code, the geometry and the
//! ruleset rows it has on its own page; this file adds only what belongs to the run as a whole:
//! the course clock, the cumulative score, the verdict, and where the run ends.
//!
//! What a swap does (`assumptions.lien_hoan_chain`): the next bài starts exactly as its own page
//! starts it — the car at that bài's start pose, at rest, engine running. Nothing of the previous
//! bài's car is carried, because no bài's judgement reads it.
//!
//! The run ends on the tick a bài is suspended (`Penalty::Disqualify`, B.I.1.4 and the per-bài
//! rows), or when bài 11 is done. After bài 11 a score under `scoring.pass` is `SH.KT.DUOI_80`.

use crate::hash::Hash;
use crate::rules::{Penalty, Ruleset};
use crate::{AUTOMATIC_BIT, DT, EXERCISE_SHIFT, Event, Session, TickInput};

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

pub struct Chain {
    rules: Ruleset,
    seed: u64,
    inner: Session,
    /// The bài being driven, 1..=11.
    lesson: u8,
    /// Steps since bài 1's start order (the first scored step is 1). 0 while the run waits for it.
    tick: u32,
    score: i32,
    time_charges: u32,
    suspended: bool,
    finished: bool,
    events: Vec<Event>,
    pending: Vec<Event>,
}

impl Chain {
    pub fn new(seed: u64, rules: Ruleset) -> Self {
        let inner = Self::open(seed, 1, &rules);
        Self {
            score: rules.scoring.base,
            rules,
            seed,
            inner,
            lesson: 1,
            tick: 0,
            time_charges: 0,
            suspended: false,
            finished: false,
            events: Vec::new(),
            pending: Vec::new(),
        }
    }

    /// The seed word of the per-bài session for `lesson`: the run's seed with the exercise id swapped
    /// for the bài's. It is the word that bài's own page runs on.
    pub(crate) fn bai_seed(seed: u64, lesson: u8) -> u64 {
        (u64::from(lesson) << EXERCISE_SHIFT) | (seed & (SEED_LOW | AUTOMATIC_BIT))
    }

    fn open(seed: u64, lesson: u8, rules: &Ruleset) -> Session {
        Session::with_ruleset(Self::bai_seed(seed, lesson), rules.clone()).expect("bài 1..=11 are exercises of the core")
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
        self.charge_time();

        let (done, disqualified) = {
            let v = self.inner.view();
            (v.phase == crate::Phase::Done, v.disqualified)
        };
        if !done {
            return;
        }
        if disqualified {
            self.suspended = true;
            self.finished = true;
        } else if self.lesson == LESSONS {
            if self.score < self.rules.scoring.pass {
                self.charge("SH.KT.DUOI_80");
            }
            self.finished = true;
        } else {
            self.lesson += 1;
            self.inner = Self::open(self.seed, self.lesson, &self.rules);
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
        h.u8(self.lesson);
        h.u32(self.tick);
        h.i32(self.score);
        h.u32(self.time_charges);
        h.bool(self.suspended);
        h.bool(self.finished);
        h.u64(self.inner.hash());
        h.u32(self.events.len() as u32);
        for e in &self.events {
            h.u32(e.tick);
            h.u16(e.code);
            h.i16(e.points);
        }
        h.raw()
    }

    /// The current bài's snapshot, so a page written for one bài reads the run unchanged; only the
    /// score and the suspension are the run's, and fields 54.. say where the run is.
    pub fn snapshot(&self) -> crate::Snapshot {
        let mut out = self.inner.snapshot();
        out[2] = f64::from(self.score);
        out[3] = f64::from(u8::from(self.suspended));
        out[54] = f64::from(self.lesson);
        out[55] = f64::from(self.tick);
        out[56] = self.verdict();
        out
    }

    pub fn course_block(&self) -> Vec<f64> {
        self.inner.course_block()
    }

    #[doc(hidden)]
    pub fn lesson(&self) -> u8 {
        self.lesson
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
