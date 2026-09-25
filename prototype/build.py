"""Bundle the prototype into a dependency-free HTML file."""
from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / "index.html").read_text()
styles = (root / "styles.css").read_text()
script = (root / "app.js").read_text()
html = html.replace('<link rel="stylesheet" href="styles.css" />', f"<style>\n{styles}\n</style>")
html = html.replace('<script src="app.js"></script>', f"<script>\n{script}\n</script>")
(root / "citadel-studio.html").write_text(html)
print("Built citadel-studio.html")
