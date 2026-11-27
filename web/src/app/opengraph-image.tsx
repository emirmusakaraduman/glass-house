import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// OpenGraph card built from the hero image: the glass house on the right, the name and one line on the left.

export const alt = "GlassHouse: transparent home and car loans on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const hero = await readFile(join(process.cwd(), "public", "hero", "glasshouse-hero.png"));
  const src = `data:image/png;base64,${hero.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#0b1120" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={980} height={630} style={{ position: "absolute", right: 0, top: 0, width: 980, height: 630, objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(90deg, #0b1120 0%, rgba(11,17,32,0.92) 38%, rgba(11,17,32,0.1) 72%)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px", width: 640 }}>
          <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -4, color: "#e0f7ff" }}>GlassHouse</div>
          <div style={{ marginTop: 12, fontSize: 40, fontWeight: 700, color: "#f1f5f9", lineHeight: 1.15 }}>Transparent home and car loans on Solana</div>
          <div style={{ marginTop: 24, fontSize: 26, color: "rgba(226,222,255,0.72)", lineHeight: 1.35 }}>Earn in USDC, borrow in USDC: loans anyone can audit, where we take the first loss.</div>
        </div>
      </div>
    ),
    size,
  );
}
