# Task timers och agentchip i statuslinjen

Datum: 2026-08-06
Status: godkänd design, redo för implementation
Repo: aqua-wasted

## Problemet

Statuslinjen visar hur mycket vatten sessionen bränt, men ingenting om tid. När en
subagent jobbar i bakgrunden syns varken att den finns, vilken modell den kör, hur
länge den hållit på eller ungefär när den blir klar. Samma sak för de externa
granskarna som körs via Codex och Kimi.

## Vad som faktiskt finns att läsa

Verifierat på maskinen 2026-08-06.

**Claude subagenter** skriver var sin fil under
`~/.claude/projects/<slug>/<sessionId>/subagents/agent-<id>.jsonl`. Där finns:

- `timestamp` på första raden, alltså starttiden
- `attributionAgent`, alltså agenttypen, exempelvis `general-purpose` eller `Explore`
- `message.model`, alltså den riktiga modellen, exempelvis `claude-opus-5`
- `agentId`

110 sådana filer ligger redan på disk med användbar spridning:

| Modell | Körningar | Median |
|---|---|---|
| Opus 5 | 44 | 460 s |
| Sonnet 5 | 38 | 260 s |
| Opus 4.8 | 11 | 367 s |
| Fable 5 | 7 | 544 s |
| Haiku 4.5 | 5 | 99 s |

**Externa CLI** syns i processlistan med modell och katalog i argv:

```
63405  00:54  node /opt/homebrew/bin/codex exec ... -c model="gpt-5.5" -C /Users/mehdi/projects/...
```

**Det som inte finns:** ingen ETA, ingenstans. Claude Code uppskattar aldrig när
något blir klart. Tid kvar måste räknas fram ur historik eller inte visas alls.

## Beslut

1. Visa förfluten tid som mätt fakta, och prognos som tydligt märkt gissning.
2. Täck båda spåren, alltså både Claude subagenter och externa CLI.
3. Bygg in i aqua-wasted som en modul som är avstängd som standard.

## Arkitektur

Fyra delar med skarpa gränser. Varje del går att testa för sig.

### `lib/collect-claude.js`

Läser huvudtranskriptet en enda gång och returnerar tre saker:

- **Turstart.** Tidsstämpeln på senaste raden med `type: "user"` som varken är
  `isSidechain` eller `isMeta`.
- **Aktiv eller inte.** Sessionen jobbar om det finns minst ett `tool_use` utan
  matchande `tool_result`. Det är exakt, till skillnad från att gissa på hur
  länge det var tyst, som ger fel svar under ett långt Bash anrop.
- **Antal levande subagenter.** Antalet `Agent` anrop utan `tool_result`.

Skannar sedan sessionens `subagents/` katalog, läser första 8 kB av varje fil för
start, typ och modell, och plockar de N senast startade som de levande. N kommer
från räkningen ovan, som är den auktoritativa källan.

Ingången till vattenberäkningen läser redan hela transkriptet. De två passen slås
ihop till ett.

### `lib/collect-cli.js`

Ett `ps -axo pid=,etime=,args=` anrop per uppritning.

- `etime` parsas som `[[dd-]hh:]mm:ss`. macOS saknar `etimes`, kontrollerat.
- Behåll bara `codex`, `kimi`, `kilo`, `qwen`.
- **Uteslut `mcp-server`.** Den ligger igång permanent och är ingen task.
- **Slå ihop dubbletter.** Varje körning syns som två processer, en nodwrapper och
  en binär. Nyckel för hopslagning är argv efter binärnamnet plus förfluten tid.
- Modell ur argv: `-c model="X"` eller `-m X`. Saknas den visas bara CLI namnet.
- Katalog ur `-C` när den finns.

### `lib/stats.js`

`durations.json` bredvid `config.json`.

```json
{
  "version": 1,
  "samples": { "claude:general-purpose:claude-opus-5": [460, 380] },
  "seenPids": { "63405": { "key": "cli:codex:gpt-5.5", "start": 1786006846 } },
  "seedCursor": 0
}
```

- Rullande fönster på 20 mätningar per nyckel, median som prognos.
- **Minst tre mätningar krävs**, annars ingen prognos.
- **Mätningar över två timmar kastas.** Ett övergivet transkript i historiken
  ligger på 45 timmar och skulle förgifta medianen.
- Claude spåret fylls på från de befintliga filerna på disk, men **inkrementellt**,
  högst tolv filer eller 40 ms per uppritning, med `seedCursor` som bokmärke.
  Att skanna alla 110 på en gång i renderingsvägen skulle riskera att Claude Code
  dödar statuslinjen för långsamhet.
- CLI spåret lär sig själv: processer som setts och sedan försvunnit ger en mätning.
- Skrivning sker bara när något faktiskt ändrats, och som tmp plus rename så att
  parallella sessioner inte kan lämna en trasig fil.

### `lib/render.js`

```
⏱ 4m18s ~2m kvar    ◆ Explore · Sonnet 5  2m14s ~2m    ◆ general · Opus 5  9m02s drar över    ◇ codex · 5.5  0m54s
```

- Huvudtimern i blekt vitgrönt, utan gradient, så den ligger lugnt bredvid lilan.
- Fylld romb är en Claude subagent, gradient violett till ljus lila.
- Ihålig romb är ett externt CLI, gradient violett till rosa, så spåren går att
  skilja åt utan att läsa texten.
- Färg väljs efter terminal: truecolor när `COLORTERM` säger det, annars 256 färger,
  annars enfärgad magenta.
- Modellnamn visas som visningsnamn, alltså `Sonnet 5` och `Codex 5.5`, inte som
  råa identifierare.
- Högst tre chip, sedan `+N`.
- När inget kör krymper raden till bara huvudtimern, dämpad, med förra turens tid.
  Höjden ändras aldrig, så ingenting hoppar.
- När tiden passerar medianen står det `drar över`, aldrig en nedräkning på noll.

## Konfiguration

```json
{
  "timers": false,
  "timersLayout": "line",
  "timersMaxChips": 3
}
```

`timers` är avstängd som standard, så npm användarna får ingen ny yta de inte bett
om. `timersLayout` kan sättas till `inline` om flerradig statuslinje inte renderar
som väntat i en viss terminal.

## Prestandabudget

Under 150 ms per uppritning. Ett `ps` anrop, `stat` på subagentfilerna, högst
8 kB läst per fil, högst åtta filer. Huvudtranskriptet läses redan i dag och får
inte läsas två gånger.

## Vad som medvetet inte byggs

- Bakgrundsagenter via `pendingBackgroundAgentCount` lämnas till en senare version.
- Ingen historik eller statistikvy, bara den levande raden.
- Ingen konfigurerbar färgpalett i version ett.

## Accepterade begränsningar

- Statuslinjen ritas om när gränssnittet uppdaterar, inte en gång per sekund.
  Timern går alltså i hopp och inte som ett stoppur.
- Prognosen är en median ur egen historik, inte ett löfte.
- En ny modell eller agenttyp går utan prognos tills den kört tre gånger.
- Flerradig statuslinje är inte verifierad mot Claude Code i förväg. Renderar den
  fel finns `timersLayout: "inline"` som utväg.
