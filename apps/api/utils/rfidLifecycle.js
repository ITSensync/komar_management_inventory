const REUSABLE_PLACEMENT_STATUSES = new Set(['outbound', 'trash']);

function canPlace(placementStatus) {
  return placementStatus === 'unplaced';
}

function canRelocate(placementStatus) {
  return placementStatus === 'placed';
}

function canClose(placementStatus) {
  return placementStatus === 'placed';
}

function canReuse(placementStatus) {
  return REUSABLE_PLACEMENT_STATUSES.has(placementStatus);
}

module.exports = {
  REUSABLE_PLACEMENT_STATUSES,
  canClose,
  canPlace,
  canRelocate,
  canReuse,
};
