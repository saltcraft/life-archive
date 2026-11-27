"""Draw an entry, then a confirmed quote. Mild mode gives an n-quote entry weight sqrt(n)."""
from collections import Counter, defaultdict
from math import sqrt
import random


def simulate(con, mode, seed=None, count=1000):
    groups = defaultdict(list)
    for e,q,w in con.execute("""SELECT entry_id,quote_id,coalesce(weight_override,1) FROM quotes JOIN entries USING(entry_id)
                               WHERE deleted_at IS NULL AND status='user_confirmed' ORDER BY entry_id,quote_id"""):
        groups[e].append((q,w))
    return draw_groups(groups,mode,seed,count)


def draw_groups(groups, mode, seed=None, count=1000):
    if mode not in ("equal_entry","mild") or type(count) != int or not 1 <= count <= 10000:
        raise ValueError("simulation")
    totals = Counter({e:0 for e in groups})
    hits = Counter({q:0 for pairs in groups.values() for q,_ in pairs})
    if groups:
        rng = random.Random(seed)
        entries = list(groups)
        weights = [sqrt(len(groups[e])) if mode == "mild" else 1 for e in entries]
        for _ in range(count):
            e = rng.choices(entries,weights)[0]
            quotes, weights_q = zip(*groups[e])
            hits[rng.choices(quotes,weights_q)[0]] += 1
            totals[e] += 1
    return dict(mode=mode,count=sum(totals.values()),entries=dict(totals),quotes=dict(hits))
