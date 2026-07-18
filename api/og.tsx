// Dynamic OG share image: the branded result card, rendered at the edge.
// /api/og                 -> generic brand card (used by og:image meta)
// /api/og?pct=74&age=21   -> personalized card for shared links
import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

export default function handler(req: Request) {
  const url = new URL(req.url);
  const pct = Math.min(Math.max(Number(url.searchParams.get("pct")) || 0, 0), 99.5);
  const age = Math.min(Math.max(Number(url.searchParams.get("age")) || 0, 0), 120);
  const personalized = pct > 0 && age > 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#0b0f14",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#8b98a5", marginBottom: 24 }}>
          Wealth<span style={{ color: "#3ddc84" }}>Rank</span>
        </div>
        {personalized ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 150, fontWeight: 800, color: "#3ddc84" }}>
              {Math.round(pct)}th
            </div>
            <div style={{ display: "flex", fontSize: 40, color: "#e8edf2" }}>
              percentile at age {age}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#e8edf2" }}>
            Where do you stand?
          </div>
        )}
        <div style={{ display: "flex", fontSize: 28, color: "#8b98a5", marginTop: 28 }}>
          Your net worth vs. everyone your age. Real Federal Reserve data.
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#22b8cf", marginTop: 16 }}>
          wealthrank-ai.vercel.app
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
