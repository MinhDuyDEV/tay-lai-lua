// Runs every golden trace through sim.wasm on both wazero engines — compiler and
// interpreter — and fails unless each prints the committed expected hash. Also runs the
// negative control: one flipped input bit must change the hash, so the check cannot pass
// by hashing nothing.
//
// Output is one line per engine per trace, so a failure names the engine that failed.
package main

import (
	"context"
	"encoding/binary"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
)

// Wire sizes, mirrored from crates/sim-core/src/lib.rs (the wasm side owns them).
const (
	inputLen = 8 // TickInput::WIRE_LEN
	eventLen = 8 // Event::WIRE_LEN
	eventCap = 64
)

func main() {
	wasmPath := flag.String("wasm", "../../build/sim.wasm", "path to sim.wasm")
	goldenDir := flag.String("golden", "../../golden", "directory holding <name>.trace and <name>.hash")
	flag.Parse()

	wasm, err := os.ReadFile(*wasmPath)
	if err != nil {
		fatalf("read %s: %v", *wasmPath, err)
	}
	traces, err := loadTraces(*goldenDir)
	if err != nil {
		fatalf("%v", err)
	}

	checks, failed := 0, 0
	for _, mode := range []struct {
		name string
		cfg  wazero.RuntimeConfig
	}{
		{"wazero-compiler", wazero.NewRuntimeConfigCompiler()},
		{"wazero-interpreter", wazero.NewRuntimeConfigInterpreter()},
	} {
		ctx := context.Background()
		rt := wazero.NewRuntimeWithConfig(ctx, mode.cfg)
		compiled, err := rt.CompileModule(ctx, wasm)
		if err != nil {
			fmt.Printf("FAIL engine=%s compile: %v\n", mode.name, err)
			failed += 2 * len(traces)
			checks += 2 * len(traces)
			_ = rt.Close(ctx)
			continue
		}
		for _, tr := range traces {
			checks += 2
			got, err := runOne(ctx, rt, compiled, tr)
			if err != nil {
				fmt.Printf("FAIL engine=%s trace=%s %v\n", mode.name, tr.name, err)
				failed += 2
				continue
			}
			flipped, err := runOne(ctx, rt, compiled, tr.flipped())
			if err != nil {
				fmt.Printf("FAIL engine=%s trace=%s negative-control %v\n", mode.name, tr.name, err)
				failed += 2
				continue
			}
			switch {
			case got != tr.want:
				fmt.Printf("FAIL engine=%s trace=%s want=%s got=%s\n", mode.name, tr.name, tr.want, got)
				failed++
			case flipped == tr.want:
				fmt.Printf("FAIL engine=%s trace=%s negative-control: one flipped input bit still gave the golden hash %s, so this trace would pass while hashing nothing\n", mode.name, tr.name, flipped)
				failed++
			default:
				fmt.Printf("ok   engine=%s trace=%s hash=%s negative-control=%s\n", mode.name, tr.name, got, flipped)
			}
		}
		_ = rt.Close(ctx)
	}

	if failed > 0 {
		fmt.Printf("\n%d of %d wazero checks failed\n", failed, checks)
		os.Exit(1)
	}
}

// runOne instantiates sim.wasm and drives one trace the way the web worker will: one
// sim_step per record, drain the event queue after each step, hash once at the end.
func runOne(ctx context.Context, rt wazero.Runtime, compiled wazero.CompiledModule, tr trace) (string, error) {
	mod, err := rt.InstantiateModule(ctx, compiled, wazero.NewModuleConfig())
	if err != nil {
		return "", fmt.Errorf("instantiate: %w", err)
	}
	defer mod.Close(ctx)

	fn := func(name string) (api.Function, error) {
		f := mod.ExportedFunction(name)
		if f == nil {
			return nil, fmt.Errorf("missing export %s", name)
		}
		return f, nil
	}
	create, err := fn("sim_create")
	if err != nil {
		return "", err
	}
	alloc, err := fn("sim_alloc")
	if err != nil {
		return "", err
	}
	step, err := fn("sim_step")
	if err != nil {
		return "", err
	}
	drain, err := fn("sim_drain_events")
	if err != nil {
		return "", err
	}
	hashFn, err := fn("sim_hash")
	if err != nil {
		return "", err
	}
	destroy, err := fn("sim_destroy")
	if err != nil {
		return "", err
	}
	free, err := fn("sim_free")
	if err != nil {
		return "", err
	}

	res, err := create.Call(ctx, binary.LittleEndian.Uint64(tr.bytes[:8]))
	if err != nil {
		return "", fmt.Errorf("sim_create: %w", err)
	}
	handle := res[0]

	res, err = alloc.Call(ctx, inputLen)
	if err != nil {
		return "", fmt.Errorf("sim_alloc: %w", err)
	}
	inPtr := uint32(res[0])
	res, err = alloc.Call(ctx, eventCap*eventLen)
	if err != nil {
		return "", fmt.Errorf("sim_alloc: %w", err)
	}
	evPtr := uint32(res[0])

	for o := 8; o+inputLen <= len(tr.bytes); o += inputLen {
		if !mod.Memory().Write(inPtr, tr.bytes[o:o+inputLen]) {
			return "", fmt.Errorf("write record %d: outside memory", (o-8)/inputLen)
		}
		if _, err := step.Call(ctx, handle, uint64(inPtr)); err != nil {
			return "", fmt.Errorf("sim_step: %w", err)
		}
		// Drain every step, like the web worker, so the event queue never grows across a
		// run in a way only one engine would notice.
		if _, err := drain.Call(ctx, handle, uint64(evPtr), eventCap); err != nil {
			return "", fmt.Errorf("sim_drain_events: %w", err)
		}
	}

	res, err = hashFn.Call(ctx, handle)
	if err != nil {
		return "", fmt.Errorf("sim_hash: %w", err)
	}
	hash := fmt.Sprintf("%016x", res[0])

	if _, err := destroy.Call(ctx, handle); err != nil {
		return "", fmt.Errorf("sim_destroy: %w", err)
	}
	if _, err := free.Call(ctx, uint64(inPtr), inputLen); err != nil {
		return "", fmt.Errorf("sim_free: %w", err)
	}
	if _, err := free.Call(ctx, uint64(evPtr), eventCap*eventLen); err != nil {
		return "", fmt.Errorf("sim_free: %w", err)
	}
	return hash, nil
}

type trace struct {
	name  string
	bytes []byte // the whole .trace file: 8-byte seed, then 8-byte records
	want  string // the golden hash as it is written in .hash
}

// flipped copies the trace and flips the sign bit of the steering in its last record, in
// memory only. The last record is the input the final sim_step consumes, so a sim that
// reads its input must carry it into the state that gets hashed; steering's sign bit is a
// 32768/32767 swing, outside any rounding that could vanish. Flipping an early record is
// not equivalent: a trace can open on frames where the controls do nothing (parked, clutch
// in), and an inert flip would fail a correct simulation.
func (t trace) flipped() trace {
	b := make([]byte, len(t.bytes))
	copy(b, t.bytes)
	last := len(b) - inputLen
	b[last+1] ^= 0x80 // last record, steering i16 high byte (the sign bit)
	return trace{name: t.name, bytes: b, want: t.want}
}

func loadTraces(dir string) ([]trace, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read golden dir %s: %v", dir, err)
	}
	var traces []trace
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".trace") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".trace")
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		if len(b) <= 8 || (len(b)-8)%inputLen != 0 {
			return nil, fmt.Errorf("%s.trace: want an 8-byte seed then at least one 8-byte record, got %d bytes", name, len(b))
		}
		h, err := os.ReadFile(filepath.Join(dir, name+".hash"))
		if err != nil {
			return nil, fmt.Errorf("%s.trace has no %s.hash beside it: %v", name, name, err)
		}
		want := strings.TrimSpace(string(h))
		if len(want) != 16 {
			return nil, fmt.Errorf("%s.hash: want 16 hex digits, got %q", name, want)
		}
		traces = append(traces, trace{name: name, bytes: b, want: want})
	}
	if len(traces) == 0 {
		return nil, fmt.Errorf("no golden traces in %s: a check that runs nothing proves nothing", dir)
	}
	return traces, nil
}

func fatalf(format string, args ...any) {
	fmt.Printf("FAIL "+format+"\n", args...)
	os.Exit(1)
}
