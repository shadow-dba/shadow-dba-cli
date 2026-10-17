'use strict';

// Zero-dependency ANSI toolkit for the shadow-dba installer.
// Pure presentation — no fs, no prompts. Honors NO_COLOR and non-TTY output.

const { stdout } = require('node:process');

// Brand palette (design/brand-board.png) as [r, g, b].
const PALETTE = {
  ORANGE: [0xff, 0x5f, 0x1f],
  LIGHT: [0xf5, 0xf5, 0xf5],
  STONE: [0xbe, 0xbe, 0xbe],
  GRANITE: [0x6e, 0x6e, 0x6e],
  CHARCOAL: [0x28, 0x28, 0x26],
};

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

function colorEnabled() {
  return Boolean(stdout.isTTY) && !process.env.NO_COLOR;
}

// Wrap text in a truecolor foreground SGR. Returns raw text when color is off.
function paint(text, rgb) {
  if (!colorEnabled()) return text;
  const [r, g, b] = rgb;
  return `${ESC}38;2;${r};${g};${b}m${text}${RESET}`;
}

// Truecolor background fill.
function fill(text, rgb) {
  if (!colorEnabled()) return text;
  const [r, g, b] = rgb;
  return `${ESC}48;2;${r};${g};${b}m${text}${RESET}`;
}

function bold(text) {
  if (!colorEnabled()) return text;
  return `${ESC}1m${text}${RESET}`;
}

// Visible width of a string, ignoring SGR escape sequences.
function visibleLength(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// › shadow-dba — orange chevron, bright "shadow", granite "dba".
function wordmark() {
  return `${paint('›', PALETTE.ORANGE)} ${bold(paint('shadow', PALETTE.LIGHT))}${paint('-dba', PALETTE.GRANITE)}`;
}

// The brand's faux mac terminal window: top bar with three traffic-light dots
// (granite, granite, orange) and box-drawing sides on a charcoal fill.
function terminalWindow(lines, opts = {}) {
  const pad = opts.pad == null ? 2 : opts.pad;
  const width = Math.max(
    opts.width || 0,
    ...lines.map((l) => visibleLength(l)),
    20
  );
  const inner = width + pad * 2;
  const dot = (rgb) => paint('●', rgb);

  const dots = `${dot(PALETTE.GRANITE)} ${dot(PALETTE.GRANITE)} ${dot(PALETTE.ORANGE)}`;
  const dotsW = 5; // three glyphs + two spaces
  const topFill = '─'.repeat(Math.max(0, inner - dotsW - 3));
  const g = (s) => paint(s, PALETTE.GRANITE);

  const out = [];
  out.push(g('┌─ ') + dots + ' ' + g(topFill) + g('┐'));
  const blank = ' '.repeat(inner);
  out.push(g('│') + fill(blank, PALETTE.CHARCOAL) + g('│'));
  for (const line of lines) {
    const right = ' '.repeat(Math.max(0, width - visibleLength(line)));
    const body = ' '.repeat(pad) + line + right + ' '.repeat(pad);
    out.push(g('│') + fill(body, PALETTE.CHARCOAL) + g('│'));
  }
  out.push(g('│') + fill(blank, PALETTE.CHARCOAL) + g('│'));
  out.push(g('└' + '─'.repeat(inner) + '┘'));
  return out.join('\n');
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function hideCursor() {
  if (colorEnabled()) stdout.write(`${ESC}?25l`);
}

function showCursor() {
  if (stdout.isTTY) stdout.write(`${ESC}?25h`);
}

function clearLine() {
  if (stdout.isTTY) stdout.write(`\r${ESC}2K`);
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Animated spinner on a single line. Falls back to a static line when output is
// not an interactive TTY (pipes/CI) so logs stay clean.
function spinner(label) {
  const animate = Boolean(stdout.isTTY) && !process.env.NO_COLOR;
  let text = label;
  let timer = null;
  let i = 0;

  const render = () => {
    clearLine();
    stdout.write(`  ${paint(SPIN_FRAMES[i], PALETTE.ORANGE)} ${text}`);
    i = (i + 1) % SPIN_FRAMES.length;
  };

  if (animate) {
    render();
    timer = setInterval(render, 80);
  }

  const stop = (symbol, finalText) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      clearLine();
    }
    stdout.write(`  ${symbol} ${finalText}\n`);
  };

  return {
    set(next) {
      text = next;
    },
    succeed(next = text) {
      stop(paint('✓', PALETTE.ORANGE), next);
    },
    fail(next = text) {
      stop(paint('✗', PALETTE.ORANGE), next);
    },
  };
}

// A single completed progress line: ✓ <text>   <hint>
function step(text, hint) {
  const mark = paint('✓', PALETTE.ORANGE);
  const tail = hint ? `   ${paint(hint, PALETTE.GRANITE)}` : '';
  return `  ${mark} ${text}${tail}`;
}

module.exports = {
  PALETTE,
  colorEnabled,
  paint,
  fill,
  bold,
  visibleLength,
  wordmark,
  terminalWindow,
  spinner,
  step,
  sleep,
  hideCursor,
  showCursor,
  clearLine,
};
