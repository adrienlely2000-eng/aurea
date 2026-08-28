/* Aurea — graphiques SVG, sans librairie externe. */

const Charts = (() => {
  function donut(items, size = 220) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (total <= 0) {
      return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 18}" fill="none" stroke="currentColor" stroke-width="16" opacity=".12"/>
      </svg>`;
    }
    const r = size / 2 - 18;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const rings = items
      .map((item) => {
        const len = (item.value / total) * c;
        const dash = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${item.color}" stroke-width="16" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" stroke-linecap="butt"/>`;
        offset += len;
        return dash;
      })
      .join("");
    return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" role="img">
      <g transform="rotate(-90 ${size / 2} ${size / 2})">${rings}</g>
    </svg>`;
  }

  function bars(rows, keyA = "spent", keyB = "earned") {
    const max = Math.max(1, ...rows.flatMap((r) => [r[keyA] || 0, r[keyB] || 0]));
    const w = 320;
    const h = 140;
    const gap = 10;
    const group = (w - 16) / rows.length;
    const barW = Math.max(6, (group - gap) / 2);
    const barsSvg = rows
      .map((r, i) => {
        const x = 8 + i * group;
        const hA = ((r[keyA] || 0) / max) * 100;
        const hB = ((r[keyB] || 0) / max) * 100;
        return `<g>
          <rect class="bar-spent" x="${x}" y="${110 - hA}" width="${barW}" height="${hA}" rx="3"/>
          <rect class="bar-earned" x="${x + barW + 3}" y="${110 - hB}" width="${barW}" height="${hB}" rx="3"/>
          <text x="${x + barW}" y="128" text-anchor="middle">${r.label}</text>
        </g>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg bars-svg" role="img">${barsSvg}</svg>`;
  }

  function area(points) {
    if (!points.length) return "";
    const w = 560;
    const h = 160;
    const padY = 16;
    const vals = points.map((p) => p.balance);
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 1);
    const span = max - min || 1;
    const coord = (i, v) => {
      const x = (i / (points.length - 1 || 1)) * w;
      const y = padY + (1 - (v - min) / span) * (h - padY * 2);
      return [x, y];
    };
    const line = points
      .map((p, i) => {
        const [x, y] = coord(i, p.balance);
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      })
      .join(" ");
    const [x0] = coord(0, points[0].balance);
    const [x1] = coord(points.length - 1, points[points.length - 1].balance);
    const base = h - padY;
    const fill = `${line} L${x1} ${base} L${x0} ${base} Z`;
    const zeroY = padY + (1 - (0 - min) / span) * (h - padY * 2);
    return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg area-svg" role="img">
      <line class="zero-line" x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}"/>
      <path class="area-fill" d="${fill}"/>
      <path class="area-line" d="${line}" fill="none"/>
    </svg>`;
  }

  return { donut, bars, area };
})();
