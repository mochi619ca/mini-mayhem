// Finish-order points. Every game produces a sorted list of rows; this module
// is the only place that decides what a place is worth.
//
// Ties share the average of the places they occupy: two players tied for 1st in
// a four-player game get (4+3)/2 = 3.5 points each instead of an arbitrary 4/3
// split decided by object order. The displayed place is the better of the tied
// places, so the number matches what the player was awarded.

export function finishOrder(rows) {
  const sorted = rows
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.score - a.score || (a.tiebreak ?? 0) - (b.tiebreak ?? 0) || a.i - b.i);

  const placeOf = new Map();
  const pointsOf = new Map();
  let i = 0;
  while (i < sorted.length) {
    const top = sorted[i];
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].score === top.score &&
      (sorted[j + 1].tiebreak ?? 0) === (top.tiebreak ?? 0)
    ) {
      j++;
    }
    // Places are 1-based; a group at index i..j occupies places i+1 .. j+1.
    const places = [];
    for (let k = i; k <= j; k++) places.push(sorted.length - k);
    const pts = places.reduce((a, b) => a + b, 0) / places.length;
    for (let k = i; k <= j; k++) {
      placeOf.set(sorted[k].id, i + 1);
      pointsOf.set(sorted[k].id, pts);
    }
    i = j + 1;
  }

  return { sorted, placeOf, pointsOf };
}
