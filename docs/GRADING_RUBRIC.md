# FlexSoar grading rubric v1

The float is the product. If two graders look at the same shoe and write
different numbers, every float on the platform is noise and the whole
value proposition goes with it. This rubric exists to make the number
reproducible, not to make it fast.

**Rules for the grader**

- Grade what is in front of you, never what the consignor claims.
  "Worn twice" is not a grade. Creasing is.
- Grade under consistent light. Same spot, same lamp, every time.
- Score all six components before computing. Do not decide the float
  first and reverse-engineer components to justify it.
- When genuinely torn between two scores on a component, take the worse
  one. Optimistic grading is the failure that destroys buyer trust.

---

## 1. Score six components, each 0.00–1.00

| # | Component | Weight | 0.00 means | 1.00 means |
|---|---|---|---|---|
| 1 | Outsole wear | 25% | Full tread, factory texture intact, no ground contact marks | Tread flat or worn through, pattern gone in high-wear zones |
| 2 | Midsole | 20% | Bright, no yellowing, no scuffs, no compression | Heavy yellowing, deep scuffing, visible compression or separation |
| 3 | Toe box creasing | 20% | No creasing under flex | Deep set creases, cracked or split material at the crease |
| 4 | Upper condition | 20% | No marks, stains, scuffs or discolouration | Heavy soiling, tears, holes, or material failure |
| 5 | Heel counter & collar | 10% | No collapse, no heel drag, padding intact | Collapsed counter, worn through lining, heavy heel drag |
| 6 | Accessories | 5% | Original box in good shape, original laces, tags present | No box, replacement laces, nothing original |

**Float = weighted sum.** Round to 3 decimals.

Worked example: outsole 0.10, midsole 0.15, creasing 0.20, upper 0.05,
heel 0.10, accessories 0.00
→ (0.10×0.25) + (0.15×0.20) + (0.20×0.20) + (0.05×0.20) + (0.10×0.10) + (0.00×0.05)
→ 0.025 + 0.030 + 0.040 + 0.010 + 0.010 + 0.000 = **0.115** (Minimal Wear)

---

## 2. Sanity-check against the band anchors

The computed float should land in the band the shoe obviously belongs to.
If it doesn't, one of your component scores is wrong — go back and find
it. Do not adjust the total.

| Band | Range | What it looks like |
|---|---|---|
| **Deadstock** | 0.000–0.020 | Never worn. Original laces unlaced or factory-laced, tags on, no flex creasing anywhere, outsole factory-clean including the texture in the tread grooves |
| **Factory New** | 0.021–0.070 | Tried on, walked indoors at most. No creasing visible at rest, faint sole contact marks only |
| **Minimal Wear** | 0.071–0.150 | A handful of wears. Light creasing visible under flex, tread fully intact, midsole clean |
| **Field Tested** | 0.151–0.380 | Regularly worn but cared for. Obvious creasing at rest, tread wear visible in high-contact zones, minor midsole marks |
| **Well Worn** | 0.381–0.450 | Heavy use. Deep creasing, significant tread loss, yellowing or scuffing throughout |
| **Battle Scarred** | 0.451–1.000 | Structural wear. Material failure, sole separation, tread worn through, heavy permanent soiling |

---

## 3. Tie-breakers for the cases that actually come up

- **Deadstock but yellowed.** Yellowing is midsole, and midsole is 20%.
  A never-worn pair with visible yellowing cannot score below 0.040.
  Age is condition.
- **"Worn twice" but creased.** Creasing is what you see. Grade it.
- **Replacement laces.** Accessories caps at 0.50 for that component.
  Original laces missing entirely, no box: accessories is 1.00.
- **Cleaned or restored.** Grade the current state, but note the
  restoration in grading notes — buyers who care will ask.
- **Icy or translucent soles.** Yellowing is expected with age and is
  scored normally. Do not be lenient because it's unavoidable.
- **Mismatched wear between left and right.** Grade the worse shoe.
- **Box damaged but present.** Accessories 0.30, not 1.00.

---

## 4. Reject rather than grade

These do not get a float. Fail authentication and return to consignor:

- Any doubt about authenticity — doubt is a rejection, not a discount
- Repaints, customs, or aftermarket soles
- Sole separation in progress or already repaired
- Odour that does not clear after airing
- Mismatched pair (different sizes, different colourways)
- Missing size or manufacturer labels

---

## 5. Photo set — 8 shots, same order every time

Required before a float can be entered. These are what the buyer sees and
what a dispute is settled against.

1. Lateral side, full profile, left shoe
2. Lateral side, full profile, right shoe
3. Medial side, both shoes
4. Top-down, both shoes, showing toe box creasing
5. Outsoles, both shoes, tread facing camera
6. Heel counters, both shoes
7. Insole and size label
8. Box label, or a note that the box is absent

Add close-ups of any defect scored above 0.30 on any component.

---

## 6. Recording

Enter the six component scores in the grading queue, not just the total.
The stored float is what mints onto the card, but the component
breakdown is what lets you re-check a disputed grade six months later
without the shoe in front of you.
