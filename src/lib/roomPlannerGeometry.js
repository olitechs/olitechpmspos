export const getStayBarGeometry = ({ startIndex, span, dayWidth, roomColumnWidth, continuesBefore = false, continuesAfter = false }) => {
  const startOffset = continuesBefore ? 0 : dayWidth / 2;
  const endOffset = continuesAfter ? 0 : dayWidth / 2;
  const left = roomColumnWidth + startIndex * dayWidth + startOffset;
  const right = roomColumnWidth + (startIndex + span) * dayWidth + endOffset;
  return { left, width: Math.max(0, right - left), continuesBefore, continuesAfter };
};

export const getPastStayOpacity = (checkOut, today) => (
  checkOut && today && checkOut <= today ? 0.55 : 1
);

export const getPaymentStatusFromAmounts = (amountPaid, totalAmount) => {
  const paid = Number(amountPaid || 0);
  const total = Number(totalAmount || 0);
  if (total > 0 && paid >= total) return 'fully_paid';
  if (paid > 0) return 'partially_paid';
  return 'not_paid';
};
