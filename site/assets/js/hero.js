/* The hero backdrop: the layout engine, dramatized.
 *
 * A cloud of points cycles through the states of a compilation — a column of
 * Markdown text, then successive slide layouts (title + bullets, metric
 * cards, a bar chart, a comparison). Blue points are the accent-colored
 * elements of the real theme (accent bars, chart series); gray dust is
 * everything else. Raw WebGL 1, no dependency; a static frame under
 * prefers-reduced-motion; the CSS gradient alone if WebGL is unavailable.
 */
(() => {
  const canvas = document.getElementById('engine');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false });
  if (!gl) {
    canvas.remove();
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- glsl
  const VS = [
    'attribute vec2 aFrom;',
    'attribute vec2 aTo;',
    'attribute vec4 aRand;',
    'attribute float aKind;',
    'uniform vec2 uRes;',
    'uniform vec2 uMouse;',
    'uniform float uPhase;',
    'uniform float uTime;',
    'uniform float uDpr;',
    'uniform float uAlpha;',
    'varying float vA;',
    'varying float vKind;',
    'void main(){',
    '  float S = 0.45;',
    '  float t = clamp(uPhase * (1.0 + S) - aRand.x * S, 0.0, 1.0);',
    '  float e = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);',
    '  vec2 p = mix(aFrom, aTo, e);',
    '  p += vec2(sin(uTime * 0.60 + aRand.z * 6.2832),',
    '            cos(uTime * 0.47 + aRand.z * 6.2832)) * 1.8;',
    '  p += uMouse * (aRand.w * 26.0);',
    '  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0,',
    '                     1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);',
    '  gl_PointSize = (1.6 + aRand.y * 1.5 + aKind * 0.9) * uDpr;',
    '  vA = (0.45 + 0.55 * aRand.y) * (1.0 - 0.35 * sin(3.1416 * t)) * uAlpha;',
    '  vKind = aKind;',
    '}',
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying float vA;',
    'varying float vKind;',
    'void main(){',
    '  float m = smoothstep(0.5, 0.12, length(gl_PointCoord - 0.5));',
    '  vec3 c = mix(vec3(0.576, 0.647, 0.780), vec3(0.334, 0.514, 0.969), vKind);',
    '  gl_FragColor = vec4(c, m * vA * (0.55 + 0.45 * vKind));',
    '}',
  ].join('\n');

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, VS);
  const fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) {
    canvas.remove();
    return;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.remove();
    return;
  }
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  const loc = {
    aFrom: gl.getAttribLocation(prog, 'aFrom'),
    aTo: gl.getAttribLocation(prog, 'aTo'),
    aRand: gl.getAttribLocation(prog, 'aRand'),
    aKind: gl.getAttribLocation(prog, 'aKind'),
    uRes: gl.getUniformLocation(prog, 'uRes'),
    uMouse: gl.getUniformLocation(prog, 'uMouse'),
    uPhase: gl.getUniformLocation(prog, 'uPhase'),
    uTime: gl.getUniformLocation(prog, 'uTime'),
    uDpr: gl.getUniformLocation(prog, 'uDpr'),
    uAlpha: gl.getUniformLocation(prog, 'uAlpha'),
  };

  // ------------------------------------------------------------- points
  const N = 2600;
  const ACCENT = Math.floor(N * 0.13); // points 0..ACCENT-1 are accent
  const DUST = N - ACCENT;

  const rand = new Float32Array(N * 4);
  const kind = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rand[i * 4] = Math.random();
    rand[i * 4 + 1] = Math.random();
    rand[i * 4 + 2] = Math.random();
    rand[i * 4 + 3] = Math.random() * 2 - 1;
    kind[i] = i < ACCENT ? 1 : 0;
  }

  // --------------------------------------------- target state builders
  // Everything is laid out in normalized slide space (x, y in 0..1 of a
  // 16:9 frame), then mapped onto the on-screen slide box.

  function rows(out, n, off, rect, lines) {
    for (let i = 0; i < n; i++) {
      const row = i % lines;
      const len = 0.5 + 0.5 * frac(Math.sin((row + 1) * 12.9898) * 43758.5453);
      out[(off + i) * 2] = rect.x + Math.random() * rect.w * len;
      out[(off + i) * 2 + 1] = rect.y + ((row + 0.5) / lines) * rect.h;
    }
  }
  function frac(v) {
    return v - Math.floor(v);
  }
  function fill(out, n, off, rect) {
    for (let i = 0; i < n; i++) {
      out[(off + i) * 2] = rect.x + Math.random() * rect.w;
      out[(off + i) * 2 + 1] = rect.y + Math.random() * rect.h;
    }
  }
  function edge(out, n, off, rect) {
    const per = 2 * (rect.w + rect.h);
    for (let i = 0; i < n; i++) {
      const t = Math.random() * per;
      let x;
      let y;
      if (t < rect.w) {
        x = rect.x + t;
        y = rect.y;
      } else if (t < rect.w + rect.h) {
        x = rect.x + rect.w;
        y = rect.y + (t - rect.w);
      } else if (t < 2 * rect.w + rect.h) {
        x = rect.x + (t - rect.w - rect.h);
        y = rect.y + rect.h;
      } else {
        x = rect.x;
        y = rect.y + (t - 2 * rect.w - rect.h);
      }
      out[(off + i) * 2] = x;
      out[(off + i) * 2 + 1] = y;
    }
  }
  function blob(out, n, off, cx, cy, r) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832;
      const d = (Math.random() + Math.random()) * 0.5 * r;
      out[(off + i) * 2] = cx + Math.cos(a) * d * 1.6;
      out[(off + i) * 2 + 1] = cy + Math.sin(a) * d;
    }
  }

  // Distribute `total` points over weighted parts: [weight, fn(out, n, off)].
  function parts(out, total, off, list) {
    let sum = 0;
    let i;
    for (i = 0; i < list.length; i++) sum += list[i][0];
    let used = 0;
    for (i = 0; i < list.length; i++) {
      const n = i === list.length - 1 ? total - used : Math.round((total * list[i][0]) / sum);
      list[i][1](out, n, off + used);
      used += n;
    }
  }

  const FRAME = { x: 0, y: 0, w: 1, h: 1 };
  const TITLE = { x: 0.06, y: 0.07, w: 0.58, h: 0.08 };
  const ABAR = { x: 0.06, y: 0.19, w: 0.1, h: 0.022 };

  const STATES = [
    function source(dust, acc) {
      // a column of Markdown
      const page = { x: 0.1, y: 0.04, w: 0.8, h: 0.92 };
      parts(dust, DUST, ACCENT, [
        [
          1,
          (o, n, f) => {
            rows(o, n, f, page, 20);
          },
        ],
      ]);
      for (let i = 0; i < ACCENT; i++) {
        // #, ::: and ``` markers at line starts
        const row = Math.floor(Math.random() * 20);
        acc[i * 2] = page.x + Math.random() * 0.04;
        acc[i * 2 + 1] = page.y + ((row + 0.5) / 20) * page.h;
      }
    },
    function title(dust, acc) {
      // title + bullets + image
      const bullets = { x: 0.06, y: 0.3, w: 0.44, h: 0.48 };
      const image = { x: 0.58, y: 0.3, w: 0.36, h: 0.48 };
      const footer = { x: 0.06, y: 0.92, w: 0.34, h: 0.015 };
      parts(dust, DUST, ACCENT, [
        [
          0.16,
          (o, n, f) => {
            edge(o, n, f, FRAME);
          },
        ],
        [
          0.14,
          (o, n, f) => {
            rows(o, n, f, TITLE, 1);
          },
        ],
        [
          0.3,
          (o, n, f) => {
            rows(o, n, f, bullets, 6);
          },
        ],
        [
          0.22,
          (o, n, f) => {
            edge(o, n, f, image);
          },
        ],
        [
          0.12,
          (o, n, f) => {
            fill(o, n, f, image);
          },
        ],
        [
          0.06,
          (o, n, f) => {
            rows(o, n, f, footer, 1);
          },
        ],
      ]);
      parts(acc, ACCENT, 0, [
        [
          1,
          (o, n, f) => {
            fill(o, n, f, ABAR);
          },
        ],
      ]);
    },
    function metrics(dust, acc) {
      // three :::metric cards
      const list = [
        [
          0.14,
          (o, n, f) => {
            edge(o, n, f, FRAME);
          },
        ],
        [
          0.12,
          (o, n, f) => {
            rows(o, n, f, TITLE, 1);
          },
        ],
      ];
      const cards = [];
      for (let c = 0; c < 3; c++) {
        const card = { x: 0.06 + c * 0.315, y: 0.32, w: 0.27, h: 0.42 };
        cards.push(card);
        ((card) => {
          list.push([
            0.14,
            (o, n, f) => {
              edge(o, n, f, card);
            },
          ]);
          list.push([
            0.08,
            (o, n, f) => {
              blob(o, n, f, card.x + card.w / 2, card.y + 0.16, 0.05);
            },
          ]);
        })(card);
      }
      parts(dust, DUST, ACCENT, list);
      const alist = [
        [
          0.5,
          (o, n, f) => {
            fill(o, n, f, ABAR);
          },
        ],
      ];
      for (let k = 0; k < 3; k++) {
        ((card) => {
          alist.push([
            0.17,
            (o, n, f) => {
              fill(o, n, f, { x: card.x + 0.03, y: card.y + 0.32, w: 0.14, h: 0.02 });
            },
          ]);
        })(cards[k]);
      }
      parts(acc, ACCENT, 0, alist);
    },
    function chart(dust, acc) {
      // planned vs actual bars
      const heights = [0.24, 0.32, 0.38, 0.44];
      const list = [
        [
          0.16,
          (o, n, f) => {
            edge(o, n, f, FRAME);
          },
        ],
        [
          0.13,
          (o, n, f) => {
            rows(o, n, f, TITLE, 1);
          },
        ],
        [
          0.08,
          (o, n, f) => {
            fill(o, n, f, { x: 0.08, y: 0.83, w: 0.66, h: 0.006 });
          },
        ],
        [
          0.1,
          (o, n, f) => {
            rows(o, n, f, { x: 0.8, y: 0.36, w: 0.13, h: 0.16 }, 4);
          },
        ],
      ];
      let i;
      for (i = 0; i < 4; i++) {
        // the "planned" series, in dust
        ((h, x) => {
          list.push([
            0.11,
            (o, n, f) => {
              fill(o, n, f, { x: x, y: 0.83 - h, w: 0.055, h: h });
            },
          ]);
        })(heights[i] * 0.9, 0.11 + i * 0.17);
      }
      parts(dust, DUST, ACCENT, list);
      const alist = [
        [
          0.2,
          (o, n, f) => {
            fill(o, n, f, ABAR);
          },
        ],
      ];
      for (i = 0; i < 4; i++) {
        // the "actual" series, in accent
        ((h, x) => {
          alist.push([
            0.2,
            (o, n, f) => {
              fill(o, n, f, { x: x, y: 0.83 - h, w: 0.055, h: h });
            },
          ]);
        })(heights[i], 0.175 + i * 0.17);
      }
      parts(acc, ACCENT, 0, alist);
    },
    function comparison(dust, acc) {
      // two columns, pros / cons
      const left = { x: 0.06, y: 0.3, w: 0.42, h: 0.52 };
      const right = { x: 0.52, y: 0.3, w: 0.42, h: 0.52 };
      parts(dust, DUST, ACCENT, [
        [
          0.15,
          (o, n, f) => {
            edge(o, n, f, FRAME);
          },
        ],
        [
          0.13,
          (o, n, f) => {
            rows(o, n, f, TITLE, 1);
          },
        ],
        [
          0.14,
          (o, n, f) => {
            edge(o, n, f, left);
          },
        ],
        [
          0.14,
          (o, n, f) => {
            edge(o, n, f, right);
          },
        ],
        [
          0.22,
          (o, n, f) => {
            rows(o, n, f, { x: left.x + 0.03, y: left.y + 0.12, w: left.w - 0.06, h: 0.34 }, 4);
          },
        ],
        [
          0.22,
          (o, n, f) => {
            rows(o, n, f, { x: right.x + 0.03, y: right.y + 0.12, w: right.w - 0.06, h: 0.34 }, 4);
          },
        ],
      ]);
      parts(acc, ACCENT, 0, [
        [
          0.34,
          (o, n, f) => {
            fill(o, n, f, ABAR);
          },
        ],
        [
          0.33,
          (o, n, f) => {
            fill(o, n, f, { x: left.x + 0.03, y: left.y + 0.05, w: 0.14, h: 0.018 });
          },
        ],
        [
          0.33,
          (o, n, f) => {
            fill(o, n, f, { x: right.x + 0.03, y: right.y + 0.05, w: 0.14, h: 0.018 });
          },
        ],
      ]);
    },
  ];

  // ------------------------------------------------- screen-space mapping
  let W = 0;
  let H = 0;
  let dpr = 1;
  const box = { x: 0, y: 0, w: 0, h: 0 };
  let targets = []; // one Float32Array (N*2, px) per state

  function computeBox() {
    const wide = W / dpr >= 900;
    const bw = wide ? Math.min(W * 0.42, 760 * dpr) : Math.min(W * 0.88, 560 * dpr);
    const bh = (bw * 9) / 16;
    box.w = bw;
    box.h = bh;
    box.x = wide ? W - bw - 0.07 * W : (W - bw) / 2;
    // narrow screens: the slide assembles below the copy, not behind it
    box.y = wide ? (H - bh) / 2 : H - bh - 0.04 * H;
  }

  // The randomness is rolled ONCE: builders run a single time, in normalized
  // slide space. A resize only remaps that geometry onto the new box —
  // otherwise every mobile URL-bar collapse would re-scramble the cloud.
  let normStates = null;
  function buildTargets() {
    computeBox();
    if (!normStates)
      normStates = STATES.map((build) => {
        const t = new Float32Array(N * 2);
        // builders write normalized coords; accent block first, dust after
        build(t, t.subarray(0, ACCENT * 2));
        return t;
      });
    targets = normStates.map((norm) => {
      const t = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        t[i * 2] = box.x + norm[i * 2] * box.w;
        t[i * 2 + 1] = box.y + norm[i * 2 + 1] * box.h;
      }
      return t;
    });
  }

  // -------------------------------------------------------------- buffers
  function makeBuffer(loc, size, data, dynamic) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  }
  let bufFrom = null;
  let bufTo = null;
  function upload(buf, data) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  }

  // --------------------------------------------------------------- cycle
  const MORPH = 1500;
  const HOLD = 3300;
  let cur = 0;
  let nxt = 1;
  let cycleStart = 0;
  const mouse = [0, 0];
  const mouseTarget = [0, 0];
  let running = true;
  let visible = true;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    W = Math.round(w * dpr);
    H = Math.round(h * dpr);
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    buildTargets();
    upload(bufFrom, targets[cur]);
    upload(bufTo, targets[nxt]);
    gl.uniform2f(loc.uRes, W, H);
    gl.uniform1f(loc.uDpr, dpr);
    gl.uniform1f(loc.uAlpha, w >= 900 ? 0.9 : 0.38);
  }

  function draw(phase, time) {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(loc.uPhase, phase);
    gl.uniform1f(loc.uTime, time);
    gl.uniform2f(loc.uMouse, mouse[0] * dpr, mouse[1] * dpr);
    gl.drawArrays(gl.POINTS, 0, N);
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (!visible) return;
    let t = now - cycleStart;
    if (t > MORPH + HOLD) {
      cur = nxt;
      nxt = (nxt + 1) % STATES.length;
      upload(bufFrom, targets[cur]);
      upload(bufTo, targets[nxt]);
      cycleStart = now;
      t = 0;
    }
    mouse[0] += (mouseTarget[0] - mouse[0]) * 0.06;
    mouse[1] += (mouseTarget[1] - mouse[1]) * 0.06;
    draw(Math.min(t / MORPH, 1), now / 1000);
  }

  // ---------------------------------------------------------------- init
  makeBuffer(loc.aRand, 4, rand, false);
  makeBuffer(loc.aKind, 1, kind, false);
  bufFrom = makeBuffer(loc.aFrom, 2, new Float32Array(N * 2), true);
  bufTo = makeBuffer(loc.aTo, 2, new Float32Array(N * 2), true);
  gl.clearColor(0, 0, 0, 0);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    running = false;
    canvas.style.display = 'none';
  });

  if (reduced) {
    // one assembled frame — the metric cards — and nothing moves
    cur = 2;
    nxt = 2;
    resize();
    draw(1, 0);
    addEventListener('resize', () => {
      resize();
      draw(1, 0);
    });
    return;
  }

  resize();
  addEventListener('resize', resize);
  addEventListener(
    'pointermove',
    (e) => {
      mouseTarget[0] = (e.clientX / innerWidth - 0.5) * 2;
      mouseTarget[1] = (e.clientY / innerHeight - 0.5) * 2;
    },
    { passive: true },
  );
  let inView = true;
  document.addEventListener('visibilitychange', () => {
    visible = inView && !document.hidden;
  });
  new IntersectionObserver(
    (entries) => {
      // records queue oldest-first; only the newest reflects current state
      inView = entries[entries.length - 1].isIntersecting;
      visible = inView && !document.hidden;
    },
    { threshold: 0.02 },
  ).observe(canvas);

  cycleStart = performance.now();
  requestAnimationFrame(frame);
})();
