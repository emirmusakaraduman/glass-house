import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// OpenGraph card: the transparent logo at its own size (655×420, never scaled up) on the brand
// navy, with one line of text under it.

export const alt = "GlassHouse: transparent home and car loans on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LOGO = { width: 655, height: 420 };
const TAGLINE = "Transparent home and car loans on Solana";

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "brand", "glasshouse-logo-transparent.png"));
  const src = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0b1120" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={LOGO.width} height={LOGO.height} style={{ width: LOGO.width, height: LOGO.height }} />
        {/* One span per letter: Satori sizes a long word wider than it draws it, which showed as a gap after "Transparent". */}
        <div style={{ marginTop: 28, display: "flex", fontSize: 40, color: "#f1f5f9" }}>
          {[...TAGLINE].map((c, i) => (c === " " ? <span key={i} style={{ width: 11 }} /> : <span key={i}>{c}</span>))}
        </div>
      </div>
    ),
    size,
  );
}
