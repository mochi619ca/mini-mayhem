// Match standings: one place decides who won the match, shared by the server and
// the tests so the rule cannot drift from what is displayed.
// Total points decide the champion, then the number of games won (a player who
// took three games beats one who never did), then the single best result. Join
// order is the last resort so the order is never arbitrary — but the room is told
// when points alone did not decide it, so nobody is told they won a tiebreak they
// did not understand.
export function comparePlayers(a, b) {
  return (
    b.points - a.points ||
    b.wins - a.wins ||
    (a.bestFinish ?? 99) - (b.bestFinish ?? 99) ||
    a.joinedAt - b.joinedAt
  );
}

export function matchStandings(players) {
  const sorted = [...players].sort(comparePlayers);
  // Places: a group equal on every meaningful measure shares the best place it
  // contains. Only the join-order fallback ever separates such a group, so
  // showing them as 1st and 2nd (rather than both 1st) would invent a win.
  const places = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const tied =
      !!prev &&
      prev.points === sorted[i].points &&
      prev.wins === sorted[i].wins &&
      prev.bestFinish === sorted[i].bestFinish;
    places.push(tied ? places[i - 1] : i + 1);
  }
  return sorted.map((p, i) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    wins: p.wins,
    rank: places[i],
    // True when the place below the top is shared with the champion: nobody
    // should be told they won outright when the match was a draw.
    shared: places.filter((place) => place === places[i]).length > 1,
    bot: !!p.bot,
  }));
}

