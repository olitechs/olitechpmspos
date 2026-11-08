export function getRoomPlannerResponsiveMode(width) {
  const viewport = Number.isFinite(Number(width)) ? Number(width) : 0;
  return {
    navigation: viewport >= 1100 ? 'rail' : 'drawer',
    toolbar: viewport <= 900 ? 'stacked' : 'inline',
    planner: viewport <= 767 ? 'day-list' : 'timeline',
    toolbarActions: viewport <= 560 ? 'full-width' : 'inline',
  };
}
