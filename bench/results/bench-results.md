# WatchParty Benchmark Test Results

- **Test Run Date**: 2026-10-14T09:20:48.413Z
- **Environment**: Intel(R) Core(TM) 5 210H (12 vCPUs), 15.61 GB RAM, Node v26.8.1 on win32 10.0.26200
- **SLA Target 1 (Control Propagation Latency)**: p95 ≤ 250 ms
- **SLA Target 2 (Post-Correction Drift)**: Max ≤ 500 ms
- **Overall Benchmark Status**: **PASS** (10/10 scenarios passing)

### Scenario Results Table

| Scenario | N Clients | Latency p50 | Latency p95 (SLA ≤250ms) | Latency Max | Drift p50 | Drift Max (SLA ≤500ms) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scalability (N=10)** | 10 | 2.83 ms | 4.74 ms ✓ | 4.83 ms | 2 ms | 3 ms ✓ | **PASS** |
| **Scalability (N=25)** | 25 | 4.26 ms | 5.8 ms ✓ | 6.03 ms | 3 ms | 6 ms ✓ | **PASS** |
| **Scalability (N=50)** | 50 | 5.75 ms | 25.21 ms ✓ | 25.57 ms | 3 ms | 27 ms ✓ | **PASS** |
| **All-Clients-Seek-at-Once Storm** | 20 | 12.63 ms | 13.15 ms ✓ | 13.21 ms | 0 ms | 1 ms ✓ | **PASS** |
| **Host Disconnects Mid-Play** | 10 | 50 ms | 50 ms ✓ | 50 ms | 0 ms | 1 ms ✓ | **PASS** |
| **Late Joiner at 40-Minute Mark** | 2 | 5.18 ms | 5.18 ms ✓ | 5.18 ms | 0 ms | 0 ms ✓ | **PASS** |
| **20% Message Drop** | 10 | 2.15 ms | 2.53 ms ✓ | 2.59 ms | 0 ms | 3 ms ✓ | **PASS** |
| **150 ms Added Jitter** | 10 | 100.48 ms | 174.33 ms ✓ | 199.18 ms | 0 ms | 34 ms ✓ | **PASS** |
| **Reconnect Loop** | 8 | 22.88 ms | 34.97 ms ✓ | 37.31 ms | 0 ms | 1 ms ✓ | **PASS** |
| **5-Minute Post-Correction Drift (100ms Sampled)** | 10 | 1.9 ms | 2.16 ms ✓ | 2.2 ms | 1.07 ms | 6.11 ms ✓ | **PASS** |

### Scenario Descriptions & Notes

- **Scalability (N=10)**: Baseline steady-state room with 10 concurrent headless WebSocket clients. Propagated 4 state commands across 10 nodes. p95 latency: 4.74ms, max drift: 3ms.
- **Scalability (N=25)**: Baseline steady-state room with 25 concurrent headless WebSocket clients. Propagated 4 state commands across 25 nodes. p95 latency: 5.8ms, max drift: 6ms.
- **Scalability (N=50)**: Baseline steady-state room with 50 concurrent headless WebSocket clients. Propagated 4 state commands across 50 nodes. p95 latency: 25.21ms, max drift: 27ms.
- **All-Clients-Seek-at-Once Storm**: 20 clients firing concurrent seek commands into the serialized room queue. Server serialized 20 simultaneous seeks without dropped messages. p95 latency: 13.15ms, max drift: 1ms.
- **Host Disconnects Mid-Play**: Host WebSocket abruptly drops while video is playing; remaining clients maintain synchronization. Playback continued uninterrupted across 9 clients during host disconnect. Max drift: 1ms.
- **Late Joiner at 40-Minute Mark**: Client joins active room running at 40:00 (2,400,000ms), receives snapshot, and converges video clock. Late joiner jumped cleanly to 40:00 mark in 5.18ms. Post-catchup drift max: 0ms (within deadband).
- **20% Message Drop**: Synthetic 20% packet loss on client WebSocket channels testing NTP sample filtering and drift recovery. Clients maintained drift within SLA despite 20% frame loss. Latency p95: 2.53ms, max drift: 3ms.
- **150 ms Added Jitter**: Asymmetric network jitter of [0, 150]ms injected on all WebSocket message transfers. NTP median-of-lowest-60% filter kept clock offset robust. p95 latency: 174.33ms, max drift: 34ms.
- **Reconnect Loop**: Subsets of clients repeatedly disconnecting, missing events, reconnecting via session tokens, and catching up. Replayed missed events from VersionedRingBuffer. Post-reconnect p95 latency: 34.97ms, max drift: 1ms.
- **5-Minute Post-Correction Drift (100ms Sampled)**: Continuous 5-minute (300s) playback sampled every 100ms across all clients, including seek and reconnect events. Evaluated 29,970 total drift samples over 300s timeline. Max observed drift: 6.11ms (SLA target: ≤500ms).

### Generated Artifacts

- **JSON Results**: [`bench-results.json`](file:///bench-results.json)
- **Latency Histogram Chart**: [`bench/results/latency_histogram.svg`](file:///bench/results/latency_histogram.svg)
- **Drift Over Time Chart**: [`bench/results/drift_over_time.svg`](file:///bench/results/drift_over_time.svg)
