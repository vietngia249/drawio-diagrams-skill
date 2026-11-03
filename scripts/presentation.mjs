export const DEFAULT_PRESENTATION_TOKENS = Object.freeze({
  fontFamily: 'Arial,Helvetica,sans-serif',
  fontSizes: { title: 18, heading: 16, body: 14, label: 14, small: 12 },
  colors: { stroke: '#000000', fill: '#ffffff', mutedStroke: '#666666' },
  strokeWidth: 1,
  label: { paddingX: 6, paddingY: 3, background: '#ffffff' },
  spacing: { nodeGap: 32, containerPadding: 24, routeClearance: 12, laneSpacing: 24 },
  selfMessage: { width: 32, height: 24, offset: 16, trackGap: 12 },
  proportions: { actor: 64 / 72, useCase: 1.8, process: 1.6, dataStore: 1.5 }
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const merge = (base, overrides, path = 'presentation') => {
  if (!isRecord(overrides)) throw new TypeError(`${path} must be an object`);
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in base)) throw new TypeError(`Unknown presentation token ${path}.${key}`);
    if (isRecord(base[key])) result[key] = merge(base[key], value, `${path}.${key}`);
    else {
      const invalidNumber = typeof value === 'number' && !Number.isFinite(value);
      const invalidString = typeof value === 'string' && (!value.trim() || value.includes(';'));
      if (typeof value !== typeof base[key] || invalidNumber || invalidString) throw new TypeError(`Invalid presentation token ${path}.${key}`);
      result[key] = value;
    }
  }
  return result;
};

export function createPresentationTokens(overrides = {}) {
  const tokens = merge(DEFAULT_PRESENTATION_TOKENS, overrides);
  for (const [key, value] of Object.entries(tokens.fontSizes)) if (value <= 0) throw new TypeError(`presentation.fontSizes.${key} must be positive`);
  if (tokens.strokeWidth <= 0) throw new TypeError('presentation.strokeWidth must be positive');
  for (const key of ['paddingX', 'paddingY']) if (tokens.label[key] < 0) throw new TypeError(`presentation.label.${key} cannot be negative`);
  for (const key of ['nodeGap', 'containerPadding', 'routeClearance', 'laneSpacing']) if (tokens.spacing[key] < 0) throw new TypeError(`presentation.spacing.${key} cannot be negative`);
  for (const [key, value] of Object.entries(tokens.selfMessage)) if (key === 'width' || key === 'height' ? value <= 0 : value < 0) throw new TypeError(`presentation.selfMessage.${key} is outside its supported range`);
  for (const [key, value] of Object.entries(tokens.proportions)) if (value <= 0) throw new TypeError(`presentation.proportions.${key} must be positive`);
  return tokens;
}

const roleDefaults = {
  title: { font: 'title', text: true },
  heading: { font: 'heading', text: true },
  body: { font: 'body', text: true },
  label: { font: 'label', text: true },
  small: { font: 'small', text: true },
  node: { font: 'body', stroke: 'stroke', fill: 'fill' },
  container: { font: 'heading', stroke: 'mutedStroke', fill: 'fill' },
  edge: { font: 'label', stroke: 'stroke' }
};

// Presentation changes only typography, colors, line weight, label padding and fill.
// Notation keys such as shape, arrows, dashes, multiplicities and direction pass through.
export function styleForRole(role, tokenOverrides = {}, baseStyle = '') {
  const roleMap = roleDefaults[role];
  if (!roleMap) throw new TypeError(`Unknown presentation role ${role}`);
  const tokens = createPresentationTokens(tokenOverrides);
  const values = {
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizes[roleMap.font],
    fontColor: tokens.colors.stroke,
    ...(roleMap.text
      ? { strokeColor: 'none', fillColor: role === 'label' ? tokens.label.background : 'none' }
      : { strokeColor: tokens.colors[roleMap.stroke], strokeWidth: tokens.strokeWidth, ...(roleMap.fill ? { fillColor: tokens.colors[roleMap.fill] } : {}) }),
    ...(role === 'label' ? {
      spacingLeft: tokens.label.paddingX, spacingRight: tokens.label.paddingX,
      spacingTop: tokens.label.paddingY, spacingBottom: tokens.label.paddingY
    } : {})
  };
  const entries = new Map(String(baseStyle).split(';').filter(Boolean).map(part => {
    const index = part.indexOf('='); return index < 0 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
  }));
  for (const [key, value] of Object.entries(values)) entries.set(key, String(value));
  return [...entries].map(([key, value]) => value === '' ? key : `${key}=${value}`).join(';') + ';';
}

export function spacingFor(kind, tokenOverrides = {}) {
  const tokens = createPresentationTokens(tokenOverrides);
  if (!(kind in tokens.spacing)) throw new TypeError(`Unknown spacing token ${kind}`);
  return tokens.spacing[kind];
}

export function selfMessageGeometry(anchor, tokenOverrides = {}) {
  const tokens = createPresentationTokens(tokenOverrides), { width, height, offset, trackGap } = tokens.selfMessage;
  const x = Number(anchor?.x), y = Number(anchor?.y), track = Number(anchor?.track ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(track) || track < 0) throw new TypeError('self-message anchor requires finite x and y and a nonnegative integer track');
  const side = anchor.side ?? 'right';
  if (!['left', 'right'].includes(side)) throw new TypeError('self-message side must be left or right');
  const direction = side === 'right' ? 1 : -1, outer = x + direction * (offset + track * trackGap), far = outer + direction * width;
  return { points: [{ x, y }, { x: far, y }, { x: far, y: y + height }, { x, y: y + height }], bounds: { x: Math.min(x, far), y, width: Math.abs(far - x), height } };
}

export function fitShapeToBounds(bounds, aspectRatio) {
  const x = Number(bounds?.x ?? 0), y = Number(bounds?.y ?? 0), width = Number(bounds?.width), height = Number(bounds?.height), ratio = Number(aspectRatio);
  if (![x, y, width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0) throw new TypeError('shape bounds and aspect ratio must be positive finite numbers');
  const fittedWidth = Math.min(width, height * ratio), fittedHeight = Math.min(height, width / ratio);
  return { x: x + (width - fittedWidth) / 2, y: y + (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}
