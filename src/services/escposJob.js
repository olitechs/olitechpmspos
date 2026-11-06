const clampByte = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(255, Math.trunc(number))) : fallback;
};

export function normalizePrintSettings(settings = {}) {
  const requestedLines = Number(settings.feedLinesBeforeCut ?? settings.feedLines ?? 2);
  const requestedDots = Number(settings.feedDotsBeforeCut ?? settings.feedDots ?? 100);
  const requestedExtra = Number(settings.extraFeedAfterCut ?? 0);
  const rawCommand = String(settings.cutCommand ?? (String(settings.cutMode || '').toLowerCase() === 'none' ? 'none' : 'gs_v_66'))
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
  const commands = {
    default: 'gs_v_66',
    gs_v_66: 'gs_v_66',
    gs_v_66_n: 'gs_v_66',
    gs_v_1: 'gs_v_1',
    partial: 'gs_v_1',
    gs_v_0: 'gs_v_0',
    full: 'gs_v_0',
    esc_i: 'esc_i',
    esc_m: 'esc_m',
    none: 'none',
    cut_mode_none: 'none',
  };
  const width = String(settings.paperWidth ?? settings.paper_width ?? '80mm').toLowerCase();
  return {
    feedLinesBeforeCut: Math.max(2, clampByte(requestedLines, 2)),
    feedDotsBeforeCut: clampByte(requestedDots, 100),
    cutCommand: commands[rawCommand] || 'gs_v_66',
    paperWidth: width === '58mm' ? '58mm' : '80mm',
    extraFeedAfterCut: clampByte(requestedExtra, 0),
  };
}

/** The only shared thermal job-ending sequence: line feed, dot feed, one cutter command. */
export function finishPrintJob(settings = {}) {
  const config = normalizePrintSettings(settings);
  let ending = String.fromCharCode(0x1b, 0x64, config.feedLinesBeforeCut);
  ending += String.fromCharCode(0x1b, 0x4a, config.feedDotsBeforeCut);
  switch (config.cutCommand) {
    case 'gs_v_1':
      ending += String.fromCharCode(0x1d, 0x56, 0x01);
      break;
    case 'gs_v_0':
      ending += String.fromCharCode(0x1d, 0x56, 0x00);
      break;
    case 'esc_i':
      ending += String.fromCharCode(0x1b, 0x69);
      break;
    case 'esc_m':
      ending += String.fromCharCode(0x1b, 0x6d);
      break;
    case 'none':
      break;
    default:
      ending += String.fromCharCode(0x1d, 0x56, 0x42, 0x00);
      break;
  }
  if (config.extraFeedAfterCut > 0) {
    ending += String.fromCharCode(0x1b, 0x4a, config.extraFeedAfterCut);
  }
  return ending;
}

export function buildEscPosPayload(text, settings = {}) {
  const body = String(text ?? '').replace(/\r/g, '').replace(/\n+$/g, '');
  const initialize = settings.initialize === false ? '' : String.fromCharCode(0x1b, 0x40);
  return initialize + String.fromCharCode(0x1b, 0x61, 0x00) + body + finishPrintJob(settings);
}
