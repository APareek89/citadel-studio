"""Render the approval brief as exactly two reviewable A4 pages."""
from pathlib import Path
import re
from xml.sax.saxutils import escape

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Paragraph
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
FONT_ROOT = Path('/Users/macbook/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/standard_fonts')
for name, filename in [('BriefSans','LiberationSans-Regular.ttf'),('BriefSansBold','LiberationSans-Bold.ttf'),('BriefSansItalic','LiberationSans-Italic.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_ROOT / filename)))
pdfmetrics.registerFontFamily('BriefSans',normal='BriefSans',bold='BriefSansBold',italic='BriefSansItalic',boldItalic='BriefSansBold')

W,H = A4
MARGIN = 43
WIDTH = W-2*MARGIN
INK = HexColor('#202123')
GRAY = HexColor('#63656b')
RULE = HexColor('#d8dadd')

def inline(text):
    text=escape(text)
    text=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<link href="\2" color="#385b63"><u>\1</u></link>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',text)
    text=re.sub(r'`([^`]+)`',r'<font color="#4d5158">\1</font>',text)
    return text

source=(ROOT/'planning/APP-BRIEF.md').read_text()
pages=source.split('<!-- PAGE BREAK -->')
assert len(pages)==2
contents=[]
for page in pages:
    paragraphs=[p.strip() for p in page.split('\n\n') if p.strip() and not p.strip().startswith('#')]
    contents.append(paragraphs)

font_size=10.15
leading=13.15
styles=[ParagraphStyle('body',fontName='BriefSans',fontSize=font_size,leading=leading,textColor=INK,spaceAfter=8),
        ParagraphStyle('references',fontName='BriefSans',fontSize=8.2,leading=10.7,textColor=GRAY,spaceAfter=5)]
paragraphs=[]
for page in contents:
    pp=[Paragraph(inline(t),styles[1] if t.startswith('**References:') else styles[0]) for t in page]
    height=sum(p.wrap(WIDTH,H)[1]+p.style.spaceAfter for p in pp)
    paragraphs.append(pp)
    print(f'Content height: {height:.1f} pt')
    assert height <= H-157, f'Brief too long: {height:.1f}pt; edit copy rather than shrinking text.'

out=ROOT/'output/pdf/agent-workbench-approval-brief.pdf'
c=canvas.Canvas(str(out),pagesize=A4)
c.setTitle('Agent Workbench - Two-page Approval Brief')
c.setAuthor('Anand Pareek / Codex')
titles=['The product and the five journeys','Scope, architecture and acceptance']
for index, pp in enumerate(paragraphs):
    c.setFillColor(GRAY)
    c.setFont('BriefSansBold',8)
    c.drawString(MARGIN,H-35,'AGENT WORKBENCH  /  APPROVAL BRIEF')
    c.setFont('BriefSans',8)
    c.drawRightString(W-MARGIN,H-35,'25 SEPTEMBER 2026')
    c.setFillColor(INK)
    c.setFont('BriefSansBold',23)
    c.drawString(MARGIN,H-73,titles[index])
    c.setFont('BriefSans',9.4)
    c.setFillColor(GRAY)
    c.drawString(MARGIN,H-93,'A real local MVP. Five modes. One inspectable application graph.')
    c.setStrokeColor(RULE)
    c.line(MARGIN,H-108,W-MARGIN,H-108)
    y=H-124
    for p in pp:
        _,height=p.wrap(WIDTH,H)
        p.drawOn(c,MARGIN,y-height)
        y-=height+p.style.spaceAfter
    assert y>36, y
    c.setStrokeColor(RULE)
    c.line(MARGIN,32,W-MARGIN,32)
    c.setFillColor(GRAY)
    c.setFont('BriefSans',7.5)
    c.drawString(MARGIN,20,'PROPOSED - IMPLEMENTATION WAITS FOR APPROVAL')
    c.drawRightString(W-MARGIN,20,f'{index+1} / 2')
    c.showPage()
c.save()
reader=PdfReader(out)
assert len(reader.pages)==2
print(out)
print(f'Verified {len(reader.pages)} pages; {sum(len(p.extract_text()) for p in reader.pages)} text characters')
