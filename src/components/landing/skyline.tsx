// The city at night, drawn as SVG. Buildings come from a fixed seed, so the skyline is the same on
// every render (and on the server), with Aether Tower rising out of the middle.

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

type Building = { x: number; w: number; h: number; windows: { x: number; y: number; lit: string }[] };

function buildings(seed: number, count: number, maxH: number, minH: number, colors: string[]): Building[] {
  const rand = seeded(seed);
  const list: Building[] = [];
  let x = -20;
  for (let i = 0; i < count && x < 1620; i++) {
    const w = 40 + Math.floor(rand() * 90);
    const h = minH + Math.floor(rand() * (maxH - minH));
    const windows: Building["windows"] = [];
    for (let wy = 14; wy < h - 10; wy += 16) {
      for (let wx = 8; wx < w - 8; wx += 12) {
        if (rand() < 0.16) windows.push({ x: x + wx, y: 900 - h + wy, lit: colors[Math.floor(rand() * colors.length)] });
      }
    }
    list.push({ x, w, h, windows });
    x += w + 4 + Math.floor(rand() * 10);
  }
  return list;
}

const far = buildings(7, 40, 420, 160, ["#2de2e6", "#b388ff"]);
const near = buildings(42, 34, 300, 90, ["#ff2e88", "#ffb627", "#2de2e6"]);

export function Skyline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#07060c" />
          <stop offset="0.55" stopColor="#1a0b2b" />
          <stop offset="1" stopColor="#3a0f3a" />
        </linearGradient>
        <linearGradient id="tower" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#120c22" />
          <stop offset="0.5" stopColor="#24183f" />
          <stop offset="1" stopColor="#0c0817" />
        </linearGradient>
        <radialGradient id="haze" cx="0.5" cy="1" r="0.7">
          <stop offset="0" stopColor="#ff2e88" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ff2e88" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)" />
      <rect width="1600" height="900" fill="url(#haze)" />

      {/* far district */}
      <g fill="#120d20">
        {far.map((b, i) => (
          <rect key={i} x={b.x} y={900 - b.h - 140} width={b.w} height={b.h + 140} />
        ))}
      </g>
      <g opacity="0.55">
        {far.flatMap((b, i) => b.windows.map((w, j) => <rect key={`${i}-${j}`} x={w.x} y={w.y - 140} width="4" height="6" fill={w.lit} />))}
      </g>

      {/* Aether Tower */}
      <g>
        <polygon points="760,900 772,120 800,40 828,120 840,900" fill="url(#tower)" stroke="#b388ff" strokeOpacity="0.45" strokeWidth="1.5" />
        <line x1="800" y1="40" x2="800" y2="-20" stroke="#b388ff" strokeWidth="2" />
        <circle cx="800" cy="-20" r="5" fill="#b388ff" className="motion-beacon" style={{ animation: "beacon 2.4s ease-in-out infinite" }} />
        {Array.from({ length: 22 }, (_, i) => (
          <rect key={i} x="784" y={160 + i * 32} width="32" height="2" fill="#b388ff" opacity={0.15 + (i % 3) * 0.12} />
        ))}
      </g>

      {/* near district */}
      <g fill="#0a0812">
        {near.map((b, i) => (
          <rect key={i} x={b.x} y={900 - b.h} width={b.w} height={b.h} />
        ))}
      </g>
      <g>
        {near.flatMap((b, i) => b.windows.map((w, j) => <rect key={`${i}-${j}`} x={w.x} y={w.y} width="5" height="7" fill={w.lit} opacity="0.8" />))}
      </g>

      {/* holo signs */}
      <g fontFamily="var(--font-chakra)" fontWeight="700">
        <text x="1010" y="700" fill="#ff2e88" fontSize="26" opacity="0.85">RUST &amp; RELIC</text>
        <text x="1250" y="560" fill="#2de2e6" fontSize="22" opacity="0.8">BAZAAR ▸ L3</text>
        <text x="1300" y="790" fill="#ffb627" fontSize="18" opacity="0.7">NOODLES 24/7</text>
      </g>
    </svg>
  );
}
