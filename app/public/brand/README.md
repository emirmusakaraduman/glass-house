# GlassHouse brand files

The GH emblem is a house outline with a chimney, with a joined G and H inside it. The G's left
and bottom strokes are the house's wall; the H's right leg is its right wall.

## Files

| File | Size | Use |
| --- | --- | --- |
| `glasshouse-logo-full.png` | 993×547, navy `#0B1120` background | Full logo where a finished picture is needed (documents, slides on their own background) |
| `glasshouse-logo-transparent.png` | 655×420, transparent | Emblem plus "GLASS HOUSE" on a dark page: OpenGraph image, pitch cover |
| `glasshouse-mark.png` | 500×330, transparent | Emblem only, large: landing page closing band, pitch close slide |
| `glasshouse-icon-512.png` | 512×512, navy background | Square app icon; `src/app/apple-icon.png` (180×180) is made from it |

In the app, draw the logo with code instead of these PNGs wherever it is small:

- `src/components/brand/LogoMark.tsx`: the emblem as SVG. `glass` (gradient, inner light, soft glow)
  for 32 px and wider; `solid` (one color, thick strokes) for 24 px and narrower. Picked by size
  unless you set `variant`.
- `src/components/brand/Logo.tsx`: emblem plus the "GLASS HOUSE" wordmark (GLASS 800, HOUSE 300,
  uppercase, 0.2em tracking, Plus Jakarta Sans), sizes `sm` / `md` / `lg`, or `markOnly`.
- `src/app/icon.svg`: the `solid` emblem on a navy rounded square (browser tab).

Copies of the four PNGs are in `pitch-deck/project/assets/`.

## Rules

- **Always on a dark background:** `#0B1120` (navy) or `#131C31` (glass surface). Never on white
  or a light color.
- **Never recolor the logo.** The cyan (`#00D2FF` to `#7BE8FF`) is part of it. No gold (`#F59E0B`)
  in or on the logo; gold stays for the one main action button.
- **Clear space:** keep at least a quarter of the emblem's height empty on every side.
- **Below 24 px use the `solid` SVG**, never a scaled-down PNG or the `glass` variant.
- Don't scale the PNGs up past their own size; they blur. Don't stretch, rotate, crop, outline or
  add shadows of another color.
