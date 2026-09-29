"""Generate the FuelSphere solution integration architecture (SAP BTP Solution
Diagram guideline, Level 2 style) as SVG and as an editable draw.io file from
one data definition, so the two can never drift apart."""
from xml.sax.saxutils import escape
import sys

W, H = 1700, 1080
BLUE, BLUE_FILL = "#0070F2", "#EBF8FF"
SAP_INNER = "#FFFFFF"
GREY, GREY_FILL = "#475E75", "#F5F6F7"
TEAL, TEAL_FILL = "#07838F", "#DAFDF5"
PINK, PINK_FILL = "#CC00DC", "#FFF0FA"
INK = "#1D2D3E"

# kind: area | box ; style: solid | dashed (dashed = planned / not yet in code)
shapes = [
    # users
    dict(id="users", kind="area", x=20, y=150, w=220, h=380, title="Users", stroke=GREY, fill=GREY_FILL),
    dict(id="u1", kind="box", x=40, y=195, w=180, h=90, title="Airline users", sub="Fuel planner, station, ops,\nfinance, crew\n(desktop / tablet browser)", stroke=GREY),
    dict(id="u2", kind="box", x=40, y=300, w=180, h=90, title="Supplier users", sub="Fuel supplier,\ninto-plane agent\n(browser)", stroke=GREY),
    dict(id="u3", kind="box", x=40, y=405, w=180, h=100, title="Administrators", sub="BTP cockpit,\nrole collections,\nS/4 sync trigger", stroke=GREY),

    # identity
    dict(id="ias", kind="box", x=660, y=30, w=440, h=80, title="SAP Cloud Identity Services", sub="Identity Authentication (IdP / proxy to corporate IdP)", stroke=BLUE, fill=BLUE_FILL),

    # BTP subaccount
    dict(id="btp", kind="area", x=270, y=140, w=900, h=910, title="SAP BTP — Subaccount (Cloud Foundry environment)", stroke=BLUE, fill=BLUE_FILL),
    dict(id="cf", kind="area", x=295, y=185, w=520, h=455, title="Cloud Foundry Runtime — MTA fuelsphere 1.0.0", stroke=BLUE, fill=SAP_INNER),
    dict(id="ui", kind="box", x=320, y=230, w=470, h=85, title="SAP Fiori UIs (SAPUI5 / Fiori elements)", sub="Fuel Orders · Fuel Tickets · Flight Dispatch · Flight Schedule\n+ web apps: Admin, Planning, Operations, Fulfillment, Invoicing", stroke=BLUE),
    dict(id="ar", kind="box", x=320, y=335, w=470, h=70, title="Application Router — fuelsphere-approuter", sub="@sap/approuter · XSUAA login · CSRF protection · routes", stroke=BLUE),
    dict(id="srv", kind="box", x=320, y=425, w=470, h=110, title="FuelSphere Service — fuelsphere-srv", sub="SAP CAP (Node.js 22) · OData V4 · 17 services\nPlanning · Orders & ePOD · Tickets · Burn & ROB · Pricing\nInvoice readiness checks · Master data sync", stroke=BLUE),
    dict(id="hdb", kind="box", x=320, y=555, w=470, h=65, title="DB deployer — fuelsphere-db-deployer", sub="HDI artefacts from CDS model", stroke=BLUE),

    dict(id="svc", kind="area", x=840, y=185, w=310, h=455, title="SAP BTP services", stroke=BLUE, fill=SAP_INNER),
    dict(id="hana", kind="box", x=860, y=225, w=270, h=65, title="SAP HANA Cloud", sub="HDI container (hdi-shared)", stroke=BLUE),
    dict(id="xsuaa", kind="box", x=860, y=305, w=270, h=65, title="Authorization & Trust Mgmt", sub="XSUAA (application) · 17 scopes", stroke=BLUE),
    dict(id="dest", kind="box", x=860, y=385, w=270, h=65, title="Destination service (lite)", sub="S/4HANA Cloud destination", stroke=BLUE),
    dict(id="conn", kind="box", x=860, y=465, w=270, h=65, title="Connectivity service (lite)", sub="", stroke=BLUE),
    dict(id="log", kind="box", x=860, y=545, w=270, h=75, title="SAP Application Logging", sub="application-logs (lite)", stroke=BLUE),

    dict(id="is", kind="area", x=295, y=665, w=855, h=215, title="SAP Integration Suite — Cloud Integration", stroke=TEAL, fill=TEAL_FILL, style="dashed"),
    dict(id="if1", kind="box", x=320, y=710, w=250, h=145, title="iFlows: FuelSphere ↔ S/4HANA", sub="Purchase order create\nGoods receipt post\nJournal entry post\nSupplier invoice data", stroke=TEAL, style="dashed"),
    dict(id="if2", kind="box", x=590, y=710, w=270, h=145, title="iFlows: third-party inbound", sub="Flight schedule (SSIM)\nDispatch / flight plan\nACARS / EFB burn & FOB\nMarket price indices", stroke=TEAL, style="dashed"),
    dict(id="if3", kind="box", x=880, y=710, w=250, h=145, title="iFlows: supplier exchange", sub="Fuel orders / releases out\nDelivery tickets in\nSupplier invoices in", stroke=TEAL, style="dashed"),

    dict(id="sac", kind="box", x=295, y=905, w=420, h=120, title="SAP Analytics Cloud", sub="Fuel cost & burn stories (optimized story)\nLive connection to HANA Cloud / OData", stroke=PINK, fill=PINK_FILL, style="dashed"),
    dict(id="legend", kind="box", x=740, y=905, w=410, h=120, title="Legend", sub="Solid border / arrow — implemented in code today\nDashed border / arrow — in certification scope,\nnot yet in the FuelSphere repository\nNumbers ①–⑩ — see data-flow table", stroke=GREY),

    # S/4HANA Cloud Public Edition
    dict(id="s4", kind="area", x=1200, y=140, w=480, h=440, title="SAP S/4HANA Cloud Public Edition", stroke=BLUE, fill=BLUE_FILL),
    dict(id="ca", kind="box", x=1225, y=185, w=430, h=60, title="Communication system + arrangements", sub="Communication user (OAuth 2.0 client credentials)", stroke=BLUE),
    dict(id="api1", kind="box", x=1225, y=260, w=430, h=140, title="Released OData APIs — read (implemented)", sub="API_BUSINESS_PARTNER (A_BusinessPartner)\nAPI_PURCHASECONTRACT_PROCESS_SRV\nAPI_COUNTRY_SRV\nPlant API (release status to be verified)", stroke=BLUE),
    dict(id="api2", kind="box", x=1225, y=415, w=430, h=140, title="Released APIs — post (planned)", sub="API_PURCHASEORDER_PROCESS_SRV\nAPI_MATERIAL_DOCUMENT_SRV (goods receipt)\nJournal entry API\nSupplier invoice API", stroke=BLUE, style="dashed"),

    # third-party
    dict(id="tp", kind="area", x=1200, y=610, w=480, h=440, title="Third-party systems", stroke=GREY, fill=GREY_FILL),
    dict(id="t1", kind="box", x=1225, y=655, w=430, h=55, title="Flight scheduling system", sub="Schedules, tails, OOOI times", stroke=GREY),
    dict(id="t2", kind="box", x=1225, y=720, w=430, h=55, title="Flight dispatch — Jeppesen JetPlan (Boeing)", sub="Fuel plan: trip, reserves, block fuel", stroke=GREY),
    dict(id="t3", kind="box", x=1225, y=785, w=430, h=55, title="Aircraft data — ACARS / EFB", sub="Fuel on board, burn, APU", stroke=GREY),
    dict(id="t4", kind="box", x=1225, y=850, w=430, h=55, title="Fuel supplier / into-plane agent systems", sub="Orders, delivery tickets, invoices", stroke=GREY),
    dict(id="t5", kind="box", x=1225, y=915, w=430, h=110, title="Price data providers", sub="Platts · Argus · SAP CPE · Jefferson System\n(market indices for contract price formulas)", stroke=GREY),
]

# arrows: (from_point, to_point, label, style)
arrows = [
    ((240, 250), (320, 272), "①", "solid"),
    ((1060, 110), (1060, 305), "②", "solid"),
    ((555, 315), (555, 335), "", "solid"),
    ((555, 405), (555, 425), "③", "solid"),
    ((790, 450), (860, 257), "④", "solid"),
    ((790, 370), (860, 337), "②", "solid"),
    ((790, 480), (860, 417), "⑤", "solid"),
    ((790, 520), (860, 582), "⑩", "solid"),
    ((1130, 417), (1225, 330), "⑤", "solid"),
    ((720, 640), (720, 665), "", "dashed"),
    ((1150, 690), (1225, 485), "⑥", "dashed"),
    ((1225, 745), (1150, 745), "⑦", "dashed"),
    ((1225, 877), (1130, 845), "⑧", "dashed"),
    ((505, 880), (505, 905), "⑨", "dashed"),
    ((720, 652), (720, 652), "⑥", "dashed"),
]


def svg():
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, Helvetica, sans-serif">',
           '<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#1D2D3E"/></marker></defs>',
           f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>',
           f'<text x="{W-20}" y="30" text-anchor="end" font-size="20" font-weight="bold" fill="{INK}">FuelSphere — Solution Integration Architecture (Level 2)</text>',
           f'<text x="{W-20}" y="54" text-anchor="end" font-size="13" fill="{GREY}">Diligent Tech India Pvt Ltd · BTP-EXT-S/4PUB · Cert ID 26150 · draft 29 Sep 2026</text>']
    for s in shapes:
        dash = ' stroke-dasharray="7,5"' if s.get("style") == "dashed" else ""
        fill = s.get("fill", "#FFFFFF")
        rx = 10 if s["kind"] == "area" else 6
        sw = 2 if s["kind"] == "area" else 1.5
        out.append(f'<rect x="{s["x"]}" y="{s["y"]}" width="{s["w"]}" height="{s["h"]}" rx="{rx}" fill="{fill}" stroke="{s["stroke"]}" stroke-width="{sw}"{dash}/>')
        if s["kind"] == "area":
            out.append(f'<text x="{s["x"]+14}" y="{s["y"]+26}" font-size="16" font-weight="bold" fill="{s["stroke"]}">{escape(s["title"])}</text>')
        else:
            out.append(f'<text x="{s["x"]+12}" y="{s["y"]+22}" font-size="14" font-weight="bold" fill="{INK}">{escape(s["title"])}</text>')
            for i, line in enumerate(s.get("sub", "").split("\n")):
                if line:
                    out.append(f'<text x="{s["x"]+12}" y="{s["y"]+42+i*17}" font-size="12.5" fill="{GREY}">{escape(line)}</text>')
    for (x1, y1), (x2, y2), lab, st in arrows:
        dash = ' stroke-dasharray="7,5"' if st == "dashed" else ""
        out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{INK}" stroke-width="1.8" marker-end="url(#ah)"{dash}/>')
        if lab:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            out.append(f'<circle cx="{mx}" cy="{my}" r="11" fill="#FFFFFF" stroke="{INK}"/><text x="{mx}" y="{my+5}" text-anchor="middle" font-size="13" font-weight="bold" fill="{INK}">{lab}</text>')
    out.append("</svg>")
    return "\n".join(out)


def drawio():
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    for s in shapes:
        dash = "dashed=1;" if s.get("style") == "dashed" else ""
        fill = s.get("fill", "#FFFFFF")
        if s["kind"] == "area":
            val = f'<b>{escape(s["title"])}</b>'
            style = f"rounded=1;arcSize=2;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=10;fontSize=14;fontColor={s['stroke']};strokeColor={s['stroke']};fillColor={fill};strokeWidth=2;{dash}"
        else:
            sub = "<br>".join(escape(l) for l in s.get("sub", "").split("\n") if l)
            val = f'<b>{escape(s["title"])}</b><br><font color="{GREY}" style="font-size:11px">{sub}</font>'
            style = f"rounded=1;arcSize=6;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=8;fontSize=12;fontColor={INK};strokeColor={s['stroke']};fillColor={fill};{dash}"
        cells.append(f'<mxCell id="{s["id"]}" value="{escape(val, {chr(34): "&quot;"})}" style="{style}" vertex="1" parent="1"><mxGeometry x="{s["x"]}" y="{s["y"]}" width="{s["w"]}" height="{s["h"]}" as="geometry"/></mxCell>')
    for i, ((x1, y1), (x2, y2), lab, st) in enumerate(arrows):
        dash = "dashed=1;" if st == "dashed" else ""
        cells.append(f'<mxCell id="e{i}" value="{lab}" style="endArrow=block;endFill=1;html=1;strokeColor={INK};fontSize=13;labelBackgroundColor=#FFFFFF;{dash}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="{x1}" y="{y1}" as="sourcePoint"/><mxPoint x="{x2}" y="{y2}" as="targetPoint"/></mxGeometry></mxCell>')
    return ('<mxfile host="app.diagrams.net"><diagram name="FuelSphere L2" id="fs-l2"><mxGraphModel dx="1700" dy="1080" grid="1" gridSize="10" page="1" pageWidth="1700" pageHeight="1080"><root>'
            + "".join(cells) + "</root></mxGraphModel></diagram></mxfile>")


open(sys.argv[1], "w").write(svg())
open(sys.argv[2], "w").write(drawio())
