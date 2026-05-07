// IEC 61672-1 A-weighting IIR filter via bilinear transform.
// Returns feedforward (b) and feedback (a) arrays for IIRFilterNode.
// Gain is normalised to 0 dB at 1 kHz per the standard.
//
// Decomposed as three second-order sections (SOS) convolved into one 6th-order filter:
//   SOS1: s²/(s+ω₁)²       — high-pass at f1 = 20.6 Hz
//   SOS2: s²/(s+ω₄)²       — high-pass at f4 = 12194 Hz (shapes upper rolloff)
//   SOS3: 1/((s+ω₂)(s+ω₃)) — poles at f2 = 107.7 Hz, f3 = 737.9 Hz
//
// Reference: IEC 61672-1:2013, Table 3. Characteristic frequencies (Hz):
//   f1 = 20.598997  f2 = 107.65265  f3 = 737.86223  f4 = 12194.217

function polyConvolve(p: number[], q: number[]): number[] {
  const out = new Array<number>(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < q.length; j++)
      out[i + j] += p[i] * q[j];
  return out;
}

function freqResponseMag(b: number[], a: number[], omega: number): number {
  let rb = 0, ib = 0, ra = 0, ia = 0;
  for (let k = 0; k < b.length; k++) { rb += b[k] * Math.cos(k * omega); ib -= b[k] * Math.sin(k * omega); }
  for (let k = 0; k < a.length; k++) { ra += a[k] * Math.cos(k * omega); ia -= a[k] * Math.sin(k * omega); }
  return Math.hypot(rb, ib) / Math.hypot(ra, ia);
}

export function buildAWeightingCoefficients(sampleRate: number): {
  feedforward: number[];
  feedback: number[];
} {
  const c = 2 * sampleRate; // bilinear transform constant (2/T)
  const [f1, f2, f3, f4] = [20.598997, 107.65265, 737.86223, 12194.217];
  const [w1, w2, w3, w4] = [f1, f2, f3, f4].map((f) => 2 * Math.PI * f);

  // SOS1: s² / (s + w1)²
  const K1 = c / (c + w1), P1 = (c - w1) / (c + w1);
  const b1 = [K1 * K1, -2 * K1 * K1, K1 * K1];
  const a1 = [1, -2 * P1, P1 * P1];

  // SOS2: s² / (s + w4)²
  const K4 = c / (c + w4), P4 = (c - w4) / (c + w4);
  const b2 = [K4 * K4, -2 * K4 * K4, K4 * K4];
  const a2 = [1, -2 * P4, P4 * P4];

  // SOS3: 1 / ((s + w2)(s + w3))
  const Kp23 = 1 / ((c + w2) * (c + w3));
  const Kd2 = (c - w2) / (c + w2), Kd3 = (c - w3) / (c + w3);
  const b3 = [Kp23, 2 * Kp23, Kp23];
  const a3 = [1, -(Kd2 + Kd3), Kd2 * Kd3];

  // Combine all three SOS into a single 6th-order filter
  const b = polyConvolve(polyConvolve(b1, b2), b3);
  const a = polyConvolve(polyConvolve(a1, a2), a3);

  // Normalise gain to 0 dB at 1 kHz
  const omega1k = (2 * Math.PI * 1000) / sampleRate;
  const gain = freqResponseMag(b, a, omega1k);
  const feedforward = b.map((v) => v / gain);

  return { feedforward, feedback: a };
}
