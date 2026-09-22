"""Move a tech-debt item: td.py close TD-0NN "closed text" | td.py open TD-0NN "open text"."""
import pathlib, sys
p = pathlib.Path("docs/tech-debt.md"); s = p.read_text()
mode, td, text = sys.argv[1:4]
if mode == "close":
    lines = s.split("\n")
    assert any(l.startswith(f"| {td} |") for l in lines), td
    s = "\n".join(l for l in lines if not l.startswith(f"| {td} |")).rstrip("\n") + f"\n| {td} | post-launch | {text} |\n"
else:
    i = s.index("\n## Closed")
    s = s[:i].rstrip("\n") + f"\n| {td} | — | {text} |\n" + s[i:]
p.write_text(s)
