#if DEBUG
import UIKit

/// Runs when the loaded bundle is the benchmark (`npm run benchmark`), and prints timings to the console.
/// Build in Release to get meaningful numbers: Yoga (C++) is several times slower unoptimized.
extension Bridge {
    static let benchmarkUpdateRounds = 10

    private struct BenchmarkSample {
        let javaScript: Duration
        let apply: Duration
        let layout: Duration
    }

    /// Must be called on the JS queue.
    var isBenchmarkBundle: Bool {
        !context.objectForKeyedSubscript("__benchmark").isUndefined
    }

    func runBenchmark(source: String) {
        run(source) { [unowned self] mountTimings in
            let mount = sample(mountTimings)

            runUpdateRounds(remaining: Self.benchmarkUpdateRounds, collected: []) { [unowned self] updates in
                print("[benchmark] views: \(nodesById.count)")
                report("mount ", mount)
                report("update", median(of: updates))
            }
        }
    }

    private func runUpdateRounds(
        remaining: Int,
        collected: [BenchmarkSample],
        completion: @escaping ([BenchmarkSample]) -> Void
    ) {
        guard remaining > 0 else {
            completion(collected)
            return
        }

        evaluate({ [unowned self] in triggerBenchmarkUpdate() }) { [unowned self] timings in
            runUpdateRounds(remaining: remaining - 1, collected: collected + [sample(timings)], completion: completion)
        }
    }

    private func triggerBenchmarkUpdate() {
        context.objectForKeyedSubscript("__benchmark").objectForKeyedSubscript("update").call(withArguments: [])
    }

    private func sample(_ timings: EvaluationTimings) -> BenchmarkSample {
        let layout = ContinuousClock().measure { rootView.layoutIfNeeded() }

        return BenchmarkSample(javaScript: timings.javaScript, apply: timings.apply, layout: layout)
    }

    private func median(of samples: [BenchmarkSample]) -> BenchmarkSample {
        func middle(_ durations: [Duration]) -> Duration {
            durations.sorted()[durations.count / 2]
        }

        return BenchmarkSample(
            javaScript: middle(samples.map(\.javaScript)),
            apply: middle(samples.map(\.apply)),
            layout: middle(samples.map(\.layout))
        )
    }

    private func report(_ label: String, _ sample: BenchmarkSample) {
        let mainThread = sample.apply + sample.layout

        print(
            "[benchmark] \(label) -> js thread: \(format(sample.javaScript)) | main thread: \(format(mainThread))",
            "(apply \(format(sample.apply)), layout \(format(sample.layout)))"
        )
    }

    private func format(_ duration: Duration) -> String {
        let milliseconds = Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15

        return String(format: "%.1f ms", milliseconds)
    }
}
#endif
