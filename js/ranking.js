async loadTop10() {
  const q = query(
    collection(this.db, "scores"),
    orderBy("rankingScore", "desc"),
    limit(10)
  );

  const snap = await getDocs(q);
  const list = [];
  snap.forEach(doc => list.push(doc.data()));
  return list;
}
