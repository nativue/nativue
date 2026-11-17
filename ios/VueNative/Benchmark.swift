#if DEBUG
import UIKit

/// Runs when the loaded bundle is the benchmark (`npm run benchmark`), and prints timings to the console.
extension Bridge {
    static let benchmarkUpdateRounds = 10

    var isBenchmarkBundle: Bool {
        !context.objectForKeyedSubscript("__benchmark").isUndefined
    }

    func runBenchmark(source: String) {
        let mountJavaScript = measure { run(source) }
        let mountLayout = measure { rootView.layoutIfNeeded() }

        var updateJavaScript: [Duration] = []
        var updateLayout: [Duration] = []

        for _ in 1...Self.benchmarkUpdateRounds {
            updateJavaScript.append(measure { triggerBenchmarkUpdate() })
            updateLayout.append(measure { rootView.layoutIfNeeded() })
        }

        print("[benchmark] views: \(nodesById.count)")
        print("[benchmark] mount  -> js+native: \(format(mountJavaScript)), layout: \(format(mountLayout))")
        print("[benchmark] update -> js+native: \(format(median(updateJavaScript))), layout: \(format(median(updateLayout))) (median of \(Self.benchmarkUpdateRounds))")
    }

    private func triggerBenchmarkUpdate() {
        context.objectForKeyedSubscript("__benchmark").objectForKeyedSubscript("update").call(withArguments: [])
    }

    private func measure(_ work: () -> Void) -> Duration {
        ContinuousClock().measure(work)
    }

    private func median(_ durations: [Duration]) -> Duration {
        durations.sorted()[durations.count / 2]
    }

    private func format(_ duration: Duration) -> String {
        String(format: "%.1f ms", Double(duration.components.attoseconds) / 1e15 + Double(duration.components.seconds) * 1000)
    }
}
#endif
