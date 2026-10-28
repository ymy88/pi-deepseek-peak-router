# pi-deepseek-peak-router

A [pi](https://pi.dev) extension that registers a virtual model called `deepseek/auto`. During the hours DeepSeek charges its peak rate, `deepseek/auto` hands the request to a cheaper endpoint on OpenRouter. Outside those hours, `deepseek/auto` hands the request to DeepSeek's own endpoint.

## Why

DeepSeek prices by the clock. Its pricing page (https://api-docs.deepseek.com/quick_start/pricing) states:

> Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.

For `deepseek-flash` the two rates differ by a factor of two:

| Hours | Input (USD / 1M tokens) | Output (USD / 1M tokens) |
|---|---|---|
| Off-peak | 0.15 | 0.60 |
| Peak | 0.30 | 1.20 |

Routed to OpenRouter during peak hours, the default landing spot is the DeepInfra entry at 0.098 input and 0.294 output. The trade-off is speed: roughly 160-200 tok/s on DeepSeek's own endpoint against roughly 60-70 tok/s on DeepInfra. This extension trades speed for money. It does not decide on the user's behalf which of the two is worth more.

## Install

```bash
pi install npm:pi-deepseek-peak-router
```

Or install straight from git:

```bash
pi install git:github.com/ymy88/pi-deepseek-peak-router
```

Two credentials are required, either as environment variables or through `/login`: `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY`.

For local development, symlink the source into pi's extension directory. Pi's extension loader accepts symbolic links.

```bash
ln -s "$PWD/src/deepseek-peak-router.ts" ~/.pi/agent/extensions/deepseek-peak-router.ts
```

## Usage

```bash
pi --model deepseek/auto
```

Or pick `deepseek / auto` with `/model` inside a session. Pi's footer shows the physical model the virtual model routed to, next to the selection.

To pin a specific upstream on OpenRouter, add `compat.openRouterRouting` to the `deepseek/deepseek-v4.1-flash-1017` entry in `~/.pi/agent/models.json` — an `only` list plus `max_price` keeps requests on one provider. This extension never touches `models.json`.

## Routing rules

| Request | Behaviour |
|---|---|
| A new message from the user | Decide by the clock: OpenRouter during peak hours, DeepSeek's endpoint otherwise |
| A follow-up after a tool result | Stay on the model that answered last |
| An automatic retry after a failure | Move to OpenRouter when the DeepSeek endpoint reported a rate limit, a timeout, or an overloaded upstream; stay where it was on every other error |
| A request the extension makes itself, such as a compaction summary | Decide by the clock |

The clock is only consulted on a new message from the user, so a long tool-using turn never changes model halfway through. Switching between models invalidates one round of prompt cache.

## Tunables

Every value lives at the top of `src/deepseek-peak-router.ts`. Run `/reload` in pi after an edit.

| Constant | Default |
|---|---|
| `OFFICIAL_PROVIDER` / `OFFICIAL_MODEL` | `deepseek` / `deepseek-flash` |
| `OPENROUTER_PROVIDER` / `OPENROUTER_MODEL` | `openrouter` / `deepseek/deepseek-v4.1-flash-1017` |
| `CAPACITY_ERROR` | `/rate.?limit\|429\|overload\|timed?\s*out\|timeout\|ETIMEDOUT\|50[23]\|capacity/i` |
| Windows inside `isPeak` | UTC `[1,4)` and `[6,10)`, Monday through Friday |
| `thinkingLevels` | `low`, `medium`, `high`, `xhigh` |

## Known limitations

- Chinese public holidays are not handled. DeepSeek charges its off-peak rate for a whole holiday, and this extension has no holiday calendar, so a holiday still routes OpenRouter for the two peak windows. The cost is a small overspend on a few days a year.
- Speed during peak hours depends on the OpenRouter upstream. `models.json` changes the upstream; it does not change the decision to leave DeepSeek's endpoint.
- When an upstream error carries no explanatory text, the extension can mistake a non-capacity failure for a capacity failure and switch once more than needed. An extra switch costs money, not correctness.

## Development

```bash
bun test
```

Two test files. `src/deepseek-peak-router.test.ts` covers the three pure functions: the peak-window predicate, capacity-error detection, and the endpoint choice. `src/deepseek-peak-router.route.test.ts` freezes the clock and calls the `route()` function the extension registers, covering the peak landing spot, the off-peak landing spot, stickiness across a window boundary, failover on a rate limit, and the error thrown when an endpoint has no credentials.

## License

MIT
