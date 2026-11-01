#!/usr/bin/env python3
"""
Genera el catálogo normalizado de Andrade (locales/andrade/catalogo.json) y lo VERIFICA
contra el Excel fuente (Andrade_Casa_Cafe_Catalogo_Mesa_Pyae.xlsx).

Regla: no se inventan productos ni precios. Cada fila del Excel se mapea a
(producto, opciones elegidas) y el precio calculado por el modelo
(precio base + deltas) debe ser idéntico al precio de la fila.
Si algo no coincide, el script termina con error.

Uso: python3 -I tools/build_catalog.py <ruta_xlsx> <salida_json>
"""
import json, sys, unicodedata
import openpyxl

FUENTE_C1 = "Carta 1 (Pizzas · Sándwiches · Lomitos)"
FUENTE_C2 = "Carta 2 (Cafetería · Desayunos y meriendas)"
PV = "POR_VALIDAR"  # todo precio queda pendiente de aprobación comercial

CATEGORIAS = [
    ("CAF_CAL", "Cafés calientes", True, ""),
    ("CAF_FRI", "Cafés fríos", True, ""),
    ("JUGOS", "Jugos naturales", True, ""),
    ("COMBOS", "Combos", True, ""),
    ("DULCES", "Dulces", True, ""),
    ("SALADOS", "Salados", True, ""),
    ("SAND_MIN", "Sándwiches y minutas", True, ""),
    ("SAND", "Sándwiches", True, ""),
    ("LOMITOS", "Lomitos", True, ""),
    ("PIZZAS", "Pizzas", True, ""),
    ("PIZZAS_P", "Pizzas personales", True, ""),
    ("PAPAS", "Papas rústicas", True, ""),
    ("CERVEZAS", "Cervezas", True, ""),
    ("BEBIDAS", "Bebidas", True, ""),
    ("ALMUERZOS", "Almuerzos", False, "PENDIENTE: menú de almuerzos no entregado. Cargar desde Admin > Catálogo."),
]

CAFES_COMBO = ["Espresso", "Doble Espresso", "Americano", "Latte", "Capuchino", "Mocachino"]

# grupo_id: (nombre, min, max, [(opcion_id, nombre, delta)], nota)
GRUPOS = {
    "G_SYRUP": ("Agregado de syrup", 0, 1, [("SY_VAI", "Vainilla", 5000), ("SY_CHO", "Chocolate", 5000), ("SY_AVE", "Avellanada", 5000), ("SY_CAR", "Caramelo", 5000)],
                "Carta 2 lo lista bajo Cafés calientes. POR VALIDAR: a qué cafés aplica. 'Avellanada' respeta la grafía de la carta."),
    "G_JUGO_SABOR": ("Sabor", 1, 1, [("JS_NAR", "Naranja", 0), ("JS_DUR", "Durazno", 0), ("JS_LIM", "Limón", 0)], ""),
    "G_JUGO_TAM": ("Tamaño", 1, 1, [("JT_250", "250 ml", 0), ("JT_500", "500 ml", 10000)], ""),
    "G_PAN": ("Pan", 1, 1, [("PAN_LAC", "Pan lactal", 0), ("PAN_CIA", "Pan ciabatta", 5000)], ""),
    "G_PROT_URU": ("Carne o pollo", 1, 1, [("PU_CAR", "Carne en tiras", 0), ("PU_POL", "Pollo", 0)], "POR VALIDAR: la carta dice 'carne en tiras o pollo'."),
    "G_PROT_MILA": ("Milanesa", 1, 1, [("PM_CAR", "Carne", 0), ("PM_POL", "Pollo", 0)], "POR VALIDAR: la carta dice 'milanesa de carne o pollo'."),
    "G_PROT_RES": ("Carne o pollo", 1, 1, [("PR_RES", "Carne de res", 0), ("PR_POL", "Pollo", 0)], "POR VALIDAR: la carta dice 'carne res o pollo'."),
    "G_PIZZA_SABOR": ("Sabor", 1, 1, [("PP_MOZ", "Mozzarella", 0), ("PP_PEP", "Pepperoni", 0), ("PP_MAR", "Margarita", 0), ("PP_POL", "Pollo Catupiry", 0), ("PP_QUA", "Quattro Formaggi", 0)], ""),
    "G_GASEOSA": ("Bebida", 1, 1, [("GA_COC", "Coca Cola", 0), ("GA_SPR", "Sprite", 0), ("GA_GUA", "Guaraná", 0)], "POR VALIDAR: marcas disponibles."),
    "G_AGUA": ("Agua", 1, 1, [("AG_CON", "Con gas", 0), ("AG_SIN", "Sin gas", 0)], ""),
    "G_RELLENO_MED": ("Relleno", 1, 1, [("RM_DDL", "Dulce de leche", 0), ("RM_GUA", "Dulce de guayaba", 0), ("RM_JYQ", "JyQ", 0), ("RM_NUT", "Nutella", 0), ("RM_PIS", "Pistacho", 0)], ""),
    "G_COBERTURA_ROLL": ("Cobertura", 1, 1, [("RC_DDL", "Dulce de leche", 0), ("RC_NUT", "Nutella", 0), ("RC_PIS", "Pistacho", 0)], ""),
    "G_EMPANADA": ("Sabor", 1, 1, [("EM_CAR", "Carne cortada a cuchillo", 0), ("EM_POL", "Pollo", 0), ("EM_CHI", "Chilena", 0)], ""),
    "G_TARTA": ("Sabor", 1, 1, [("TA_CAP", "Caprese", 0), ("TA_POL", "Pollo Catupiry", 0), ("TA_JYQ", "JyQ", 0)], ""),
    "G_CC_CAFE": ("Café a elección", 1, 1, [("CCC_" + str(i), n, 0) for i, n in enumerate(CAFES_COMBO)], "POR VALIDAR: lista de cafés elegibles en combos."),
    "G_CC_MED": ("Medialuna o roll", 1, 1, [("CCM_MED", "Medialuna", 0), ("CCM_ROL", "Roll", 0)], ""),
    "G_CT_COCIDO": ("Cocido", 1, 1, [("CTC_NEG", "Negro", 0), ("CTC_LEC", "Con leche", 0)], ""),
    "G_CA_CAFE1": ("Café 1", 1, 1, [("CA1_" + str(i), n, 0) for i, n in enumerate(CAFES_COMBO)], "POR VALIDAR: lista de cafés elegibles en combos."),
    "G_CA_CAFE2": ("Café 2", 1, 1, [("CA2_" + str(i), n, 0) for i, n in enumerate(CAFES_COMBO)], "POR VALIDAR: lista de cafés elegibles en combos."),
    "G_CA_RELLENO": ("Relleno de la medialuna", 1, 1, [("CAR_DDL", "Dulce de leche", 0), ("CAR_GUA", "Dulce de guayaba", 0), ("CAR_JYQ", "JyQ", 0), ("CAR_NUT", "Nutella", 0), ("CAR_PIS", "Pistacho", 0)], "POR VALIDAR"),
}


# Mitad y mitad (pedido de Andrade, 10/10/2026). No hay precios nuevos: la diferencia de cada sabor sale de
# las pizzas enteras de la carta (precio del sabor − precio de Muzzarella) y se cobra el sabor MÁS CARO
# (regla MAYOR). La pizza personal cuesta lo mismo en todos los sabores, así que su segunda mitad no suma.
SABORES_GRANDE = [("MOZ", "Muzzarella", "PIZZA_MUZZARELLA"), ("PEP", "Peperoni", "PIZZA_PEPERONI"), ("MAR", "Margarita", "PIZZA_MARGARITA"),
                  ("POL", "Pollo Catupiry", "PIZZA_POLLO_CATUPIRY"), ("QUA", "Quattro Formaggi", "PIZZA_QUATTRO")]
REGLA = {"G_MITAD_1": "MAYOR", "G_MITAD_2": "MAYOR"}

SY = ["G_SYRUP"]
# (producto_id, categoria, nombre, descripcion, precio_base, grupos, fuente, nota)
P = [
    ("ESPRESSO", "CAF_CAL", "Espresso", "", 12000, SY, FUENTE_C2, ""),
    ("DOBLE_ESPRESSO", "CAF_CAL", "Doble Espresso", "", 16000, SY, FUENTE_C2, ""),
    ("AMERICANO", "CAF_CAL", "Americano", "", 20000, SY, FUENTE_C2, ""),
    ("LATTE", "CAF_CAL", "Latte", "", 20000, SY, FUENTE_C2, ""),
    ("CAPUCHINO", "CAF_CAL", "Capuchino", "", 25000, SY, FUENTE_C2, ""),
    ("CAPUCHINO_ANDRADE", "CAF_CAL", "Capuchino Andrade", "Con crema", 30000, SY, FUENTE_C2, ""),
    ("MOCACHINO", "CAF_CAL", "Mocachino", "", 25000, SY, FUENTE_C2, ""),
    ("CHOCOLATE", "CAF_CAL", "Chocolate", "", 25000, [], FUENTE_C2, ""),
    ("TE", "CAF_CAL", "Té", "", 7000, [], FUENTE_C2, ""),
    ("COCIDO", "CAF_CAL", "Cocido", "", 10000, [], FUENTE_C2, ""),
    ("ICED_LATTE", "CAF_FRI", "Iced Latte", "", 30000, [], FUENTE_C2, ""),
    ("AMERICANO_FRIO", "CAF_FRI", "Americano frío", "", 20000, [], FUENTE_C2, ""),
    ("AFFOGATO", "CAF_FRI", "Affogato", "", 25000, [], FUENTE_C2, ""),
    ("FRAPPE", "CAF_FRI", "Frappe", "Helado, espresso, hielo, leche, syrup", 40000, [], FUENTE_C2, ""),
    ("ESPRESSO_TONICO", "CAF_FRI", "Espresso tónico", "Agua tónica, espresso e hielo", 25000, [], FUENTE_C2, ""),
    ("JUGO_NATURAL", "JUGOS", "Jugo natural", "Naranja, durazno o limón", 10000, ["G_JUGO_SABOR", "G_JUGO_TAM"], "Cartas 1 y 2", ""),
    ("COMBO_COMPLETO", "COMBOS", "Combo Completo", "1 café a elección · 1 medialuna o roll · Huevos revueltos · Tostadas · Dulce de guayaba y manteca · 1 jugo de naranja", 65000, ["G_CC_CAFE", "G_CC_MED"], FUENTE_C2, "POR VALIDAR: cafés elegibles."),
    ("COMBO_TRADICIONAL", "COMBOS", "Combo Tradicional", "1 cocido (negro o con leche) · 1 chipa · 1 mbejú · 1 jugo", 45000, ["G_CT_COCIDO"], FUENTE_C2, "POR VALIDAR: sabor del jugo incluido."),
    ("COMBO_ANDRADE", "COMBOS", "Combo Andrade", "2 cafés a elección · 1 medialuna rellena · 1 roll de canela · 1 mixto XL · 1 jarrita de jugo", 80000, ["G_CA_CAFE1", "G_CA_CAFE2", "G_CA_RELLENO"], FUENTE_C2, "POR VALIDAR: cafés elegibles, tipo de roll y sabor de la jarrita."),
    ("MEDIALUNA", "DULCES", "Medialuna sin relleno", "", 12000, [], FUENTE_C2, ""),
    ("MEDIALUNA_RELLENA", "DULCES", "Medialuna rellena", "Dulce de leche · Dulce de guayaba · JyQ · Nutella · Pistacho", 15000, ["G_RELLENO_MED"], FUENTE_C2, ""),
    ("ROLL", "DULCES", "Roll de canela sin cobertura", "", 12000, [], FUENTE_C2, ""),
    ("ROLL_COBERTURA", "DULCES", "Roll de canela con cobertura", "Dulce de leche · Nutella · Pistacho", 15000, ["G_COBERTURA_ROLL"], FUENTE_C2, ""),
    ("TORTA_MARMOLADA", "DULCES", "Torta marmolada", "", 15000, [], FUENTE_C2, ""),
    ("TORTA_BANANA", "DULCES", "Torta de banana", "", 15000, [], FUENTE_C2, ""),
    ("TORTA_NARANJA", "DULCES", "Torta de naranja", "", 15000, [], FUENTE_C2, ""),
    ("CARROT_CAKE", "DULCES", "Carrot cake", "", 25000, [], FUENTE_C2, ""),
    ("ALFAJOR", "DULCES", "Alfajor de maicena", "", 10000, [], FUENTE_C2, ""),
    ("COOKIES", "DULCES", "Cookies", "", 12000, [], FUENTE_C2, ""),
    ("BROWNIE", "DULCES", "Brownie", "", 15000, [], FUENTE_C2, ""),
    ("BROWNIE_HELADO", "DULCES", "Brownie con helado", "", 25000, [], FUENTE_C2, ""),
    ("LIMON_PIE", "DULCES", "Limón pie", "", 25000, [], FUENTE_C2, ""),
    ("TOSTADAS_FRANCESAS", "DULCES", "Tostadas francesas", "", 30000, [], FUENTE_C2, ""),
    ("CHIPA", "SALADOS", "Chipa tradicional", "", 8000, [], FUENTE_C2, ""),
    ("MBEJU", "SALADOS", "Mbejú tradicional", "", 15000, [], FUENTE_C2, ""),
    ("MBEJU_JYQ", "SALADOS", "Mbejú JyQ", "", 20000, [], FUENTE_C2, ""),
    ("MBEJU_CAPRESE", "SALADOS", "Mbejú Caprese", "", 25000, [], FUENTE_C2, ""),
    ("MIXTO", "SALADOS", "Mixto tradicional", "", 15000, [], FUENTE_C2, ""),
    ("MIXTO_DOBLE", "SALADOS", "Mixto doble JyQ", "", 20000, [], FUENTE_C2, ""),
    ("MIXTO_CAPRESE", "SALADOS", "Mixto Capresse", "", 25000, [], FUENTE_C2, "Grafía de carta: Capresse."),
    ("HUEVOS_REVUELTOS", "SALADOS", "Huevos revueltos", "", 20000, [], FUENTE_C2, ""),
    ("OMELETTE_JYQ", "SALADOS", "Omelette JyQ", "", 25000, [], FUENTE_C2, ""),
    ("OMELETTE_CAPRESE", "SALADOS", "Omelette Caprese", "", 30000, [], FUENTE_C2, ""),
    ("EMPANADA", "SAND_MIN", "Empanada al horno", "Carne cortada a cuchillo · Pollo · Chilena", 12000, ["G_EMPANADA"], FUENTE_C2, ""),
    ("SANDWICH_JYQ", "SAND_MIN", "Sándwich JyQ", "", 12000, [], FUENTE_C2, ""),
    ("TARTA", "SAND_MIN", "Tartas", "Caprese · Pollo Catupiry · JyQ", 15000, ["G_TARTA"], FUENTE_C2, ""),
    ("SAND_VERDURAS", "SAND_MIN", "Sándwich de verduras", "", 15000, [], FUENTE_C2, ""),
    ("SAND_MILA_CARNE", "SAND_MIN", "Sándwich de milanesa de carne", "", 24000, [], FUENTE_C2, ""),
    ("SAND_MILA_POLLO", "SAND_MIN", "Sándwich de milanesa de pollo", "", 20000, [], FUENTE_C2, ""),
    ("SAND_POLLO_DES", "SAND_MIN", "Sándwich de pollo desmechado", "", 20000, [], FUENTE_C2, ""),
    ("FUN_CLUB", "SAND", "Fun Club", "Pan miga, tomate, lechuga, jamón y queso, huevo duro, desmechado de pollo.", 45000, [], FUENTE_C1, ""),
    ("PANINI_CESAR", "SAND", "Panini César", "Lechuga, tomate, cubos de pollo salteados, salsa.", 35000, ["G_PAN"], FUENTE_C1, ""),
    ("PANINI_URUGUAYO", "SAND", "Panini Uruguayo", "Lechuga, tomate, carne en tiras o pollo, queso, huevo, salsa.", 40000, ["G_PAN", "G_PROT_URU"], FUENTE_C1, ""),
    ("DESMECHADO_ASADO", "SAND", "Desmechado de asado", "Desmechado de asado, cebolla caramelizada, queso y lechuga.", 35000, ["G_PAN"], FUENTE_C1, ""),
    ("ESPECIAL_MILA", "SAND", "Especial de mila", "Milanesa de carne o pollo, jamón, queso, lechuga y tomate.", 35000, ["G_PAN", "G_PROT_MILA"], FUENTE_C1, ""),
    ("POLLO_CURRY", "SAND", "Pollo al curry", "Pollo en salsa curry, lechuga y tomate.", 35000, ["G_PAN"], FUENTE_C1, ""),
    ("PECETO", "SAND", "Peceto", "Peceto, rúcula, queso y tomate.", 40000, ["G_PAN"], FUENTE_C1, ""),
    ("SANDWICHON_LOMITO", "LOMITOS", "Sandwichón de lomito", "Lechuga, tomate, carne res o pollo, queso, huevo, panceta y salsa.", 45000, ["G_PROT_RES"], FUENTE_C1, ""),
    ("LOMITO_CALLEJERO", "LOMITOS", "Lomito callejero", "Lechuga, tomate, carne res o pollo, queso, huevo, salsa.", 32000, ["G_PROT_RES"], FUENTE_C1, ""),
    ("PIZZA_MUZZARELLA", "PIZZAS", "Muzzarella", "Salsa de tomate, queso mozzarella, aceitunas, orégano.", 45000, [], FUENTE_C1, ""),
    ("PIZZA_PEPERONI", "PIZZAS", "Peperoni", "Salsa de tomate, queso mozzarella, peperoni, aceitunas.", 60000, [], FUENTE_C1, "Grafía de carta: PEPERONI (personales: Pepperoni)."),
    ("PIZZA_MARGARITA", "PIZZAS", "Margarita", "Salsa de tomate, queso mozzarella, tomate, pesto, albahaca fresca, orégano.", 65000, [], FUENTE_C1, ""),
    ("PIZZA_POLLO_CATUPIRY", "PIZZAS", "Pollo Catupiry", "Salsa de tomate, queso mozzarella, pollo salteado, queso catupiry, orégano.", 65000, [], FUENTE_C1, ""),
    ("PIZZA_QUATTRO", "PIZZAS", "Quattro Formaggi", "Salsa de tomate, 4 tipos de quesos, orégano.", 65000, [], FUENTE_C1, ""),
    ("PIZZA_PERSONAL", "PIZZAS_P", "Pizza personal", "Los mismos sabores, en formato personal.", 30000, ["G_PIZZA_SABOR"], "Cartas 1 y 2", "Carta 2 también lista 'Pizza personal'; se unifica en un solo producto."),
    ("PAPAS_RUSTICAS", "PAPAS", "Papas rústicas", "Con mayo de la casa con pesto.", 15000, [], FUENTE_C1, ""),
    ("CHOP_HEINEKEN", "CERVEZAS", "Chop Heineken", "", 18000, [], "Cartas 1 y 2", ""),
    ("MUNICH_ULTRA", "CERVEZAS", "Munich Ultra", "", 15000, [], "Cartas 1 y 2", "Grafías: Múnich (carta 1) / Munich (carta 2)."),
    ("APEROL", "BEBIDAS", "Aperol", "", 55000, [], FUENTE_C1, ""),
    ("CAIPIRINA", "BEBIDAS", "Caipiriña", "", 25000, [], FUENTE_C1, ""),
    ("SANGRIA", "BEBIDAS", "Sangría", "", 25000, [], FUENTE_C1, ""),
    ("GASEOSA", "BEBIDAS", "Gaseosa 500 ml", "Coca Cola · Sprite · Guaraná", 10000, ["G_GASEOSA"], FUENTE_C1, ""),
    ("AGUA", "BEBIDAS", "Agua 500 ml", "Con o sin gas", 5000, ["G_AGUA"], FUENTE_C1, ""),
    ("AGUA_TONICA", "BEBIDAS", "Agua tónica 500 ml", "", 9000, [], FUENTE_C1, ""),
]

# Productos que no están en el Excel pero se derivan de él (sin precios nuevos). No se verifican contra filas.
P_EXTRA_IDS = {"PIZZA_MITAD"}
def _precio(pid):
    return [p for p in P if p[0] == pid][0][4]
_BASE_MITAD = _precio("PIZZA_MUZZARELLA")
for _g, _n in (("G_MITAD_1", "1ª mitad"), ("G_MITAD_2", "2ª mitad")):
    GRUPOS[_g] = (_n, 1, 1, [("M" + _g[-1] + "_" + k, n, _precio(pid) - _BASE_MITAD) for k, n, pid in SABORES_GRANDE],
                  "Mitad y mitad: se cobra el sabor más caro (regla MAYOR). Diferencias derivadas de las pizzas enteras de la carta.")
GRUPOS["G_PIZZA_MITAD_P"] = ("Mitad y mitad con", 0, 1, [("PX_" + o[0][3:], o[1], 0) for o in GRUPOS["G_PIZZA_SABOR"][3]],
                             "Opcional. La pizza personal cuesta igual en todos los sabores.")
P.append(("PIZZA_MITAD", "PIZZAS", "Pizza mitad y mitad", "Elegí dos sabores. Se cobra el precio del sabor más caro.", _BASE_MITAD,
          ["G_MITAD_1", "G_MITAD_2"], "Pedido de Andrade (10/10/2026) · precios de la carta", "POR VALIDAR: regla de cobro (sabor más caro)."))
_pp = [i for i, p in enumerate(P) if p[0] == "PIZZA_PERSONAL"][0]
P[_pp] = P[_pp][:5] + (["G_PIZZA_SABOR", "G_PIZZA_MITAD_P"],) + P[_pp][6:]

# Mapeo de cada fila del Excel -> (producto_id, [opcion_ids]) o ("MODIFICADOR", grupo, opcion) o ("DUPLICADO", producto_id, ops)
def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower().strip()
    return " ".join(s.split())

MAP = {
    ("fun club", "unica"): ("FUN_CLUB", []),
    ("panini cesar", "pan lactal"): ("PANINI_CESAR", ["PAN_LAC"]),
    ("panini cesar", "pan ciabatta"): ("PANINI_CESAR", ["PAN_CIA"]),
    ("panini uruguayo", "pan lactal"): ("PANINI_URUGUAYO", ["PAN_LAC", "PU_CAR"]),
    ("panini uruguayo", "pan ciabatta"): ("PANINI_URUGUAYO", ["PAN_CIA", "PU_POL"]),
    ("sandwichon de lomito", "unica"): ("SANDWICHON_LOMITO", ["PR_RES"]),
    ("lomito callejero", "unica"): ("LOMITO_CALLEJERO", ["PR_POL"]),
    ("desmechado de asado", "pan lactal"): ("DESMECHADO_ASADO", ["PAN_LAC"]),
    ("desmechado de asado", "pan ciabatta"): ("DESMECHADO_ASADO", ["PAN_CIA"]),
    ("especial de mila", "pan lactal"): ("ESPECIAL_MILA", ["PAN_LAC", "PM_CAR"]),
    ("especial de mila", "pan ciabatta"): ("ESPECIAL_MILA", ["PAN_CIA", "PM_POL"]),
    ("pollo al curry", "pan lactal"): ("POLLO_CURRY", ["PAN_LAC"]),
    ("pollo al curry", "pan ciabatta"): ("POLLO_CURRY", ["PAN_CIA"]),
    ("peceto", "pan lactal"): ("PECETO", ["PAN_LAC"]),
    ("peceto", "pan ciabatta"): ("PECETO", ["PAN_CIA"]),
    ("muzzarella", "estandar"): ("PIZZA_MUZZARELLA", []),
    ("peperoni", "estandar"): ("PIZZA_PEPERONI", []),
    ("margarita", "estandar"): ("PIZZA_MARGARITA", []),
    ("pollo catupiry", "estandar"): ("PIZZA_POLLO_CATUPIRY", []),
    ("quattro formaggi", "estandar"): ("PIZZA_QUATTRO", []),
    ("pizzas personales", "mozzarella"): ("PIZZA_PERSONAL", ["PP_MOZ"]),
    ("pizzas personales", "pepperoni"): ("PIZZA_PERSONAL", ["PP_PEP"]),
    ("pizzas personales", "margarita"): ("PIZZA_PERSONAL", ["PP_MAR"]),
    ("pizzas personales", "pollo catupiry"): ("PIZZA_PERSONAL", ["PP_POL"]),
    ("pizzas personales", "quattro formaggi"): ("PIZZA_PERSONAL", ["PP_QUA"]),
    ("papas rusticas", "unica"): ("PAPAS_RUSTICAS", []),
    ("chop heineken", "unica"): ("CHOP_HEINEKEN", []),
    ("munich ultra / munich ultra", "unica"): ("MUNICH_ULTRA", []),
    ("aperol", "unica"): ("APEROL", []),
    ("caipirina", "unica"): ("CAIPIRINA", []),
    ("sangria", "unica"): ("SANGRIA", []),
    ("naranja", "250 ml"): ("JUGO_NATURAL", ["JS_NAR", "JT_250"]),
    ("naranja", "500 ml"): ("JUGO_NATURAL", ["JS_NAR", "JT_500"]),
    ("durazno", "250 ml"): ("JUGO_NATURAL", ["JS_DUR", "JT_250"]),
    ("durazno", "500 ml"): ("JUGO_NATURAL", ["JS_DUR", "JT_500"]),
    ("limon", "250 ml"): ("JUGO_NATURAL", ["JS_LIM", "JT_250"]),
    ("limon", "500 ml"): ("JUGO_NATURAL", ["JS_LIM", "JT_500"]),
    ("coca cola/sprite/guarana 500 ml", "coca cola"): ("GASEOSA", ["GA_COC"]),
    ("coca cola/sprite/guarana 500 ml", "sprite"): ("GASEOSA", ["GA_SPR"]),
    ("coca cola/sprite/guarana 500 ml", "guarana"): ("GASEOSA", ["GA_GUA"]),
    ("agua con o sin gas 500 ml", "con gas"): ("AGUA", ["AG_CON"]),
    ("agua con o sin gas 500 ml", "sin gas"): ("AGUA", ["AG_SIN"]),
    ("agua tonica 500 ml", "unica"): ("AGUA_TONICA", []),
    ("espresso", "unica"): ("ESPRESSO", []),
    ("doble espresso", "unica"): ("DOBLE_ESPRESSO", []),
    ("americano", "unica"): ("AMERICANO", []),
    ("latte", "unica"): ("LATTE", []),
    ("capuchino", "unica"): ("CAPUCHINO", []),
    ("capuchino andrade", "unica"): ("CAPUCHINO_ANDRADE", []),
    ("mocachino", "unica"): ("MOCACHINO", []),
    ("chocolate", "unica"): ("CHOCOLATE", []),
    ("te", "unica"): ("TE", []),
    ("cocido", "unica"): ("COCIDO", []),
    ("iced latte", "unica"): ("ICED_LATTE", []),
    ("americano frio", "unica"): ("AMERICANO_FRIO", []),
    ("affogato", "unica"): ("AFFOGATO", []),
    ("frappe", "unica"): ("FRAPPE", []),
    ("espresso tonico", "unica"): ("ESPRESSO_TONICO", []),
    ("combo completo", "unica"): ("COMBO_COMPLETO", ["CCC_0", "CCM_MED"]),
    ("combo tradicional", "unica"): ("COMBO_TRADICIONAL", ["CTC_NEG"]),
    ("combo andrade", "unica"): ("COMBO_ANDRADE", ["CA1_0", "CA2_1", "CAR_DDL"]),
    ("medialuna sin relleno", "unica"): ("MEDIALUNA", []),
    ("medialuna rellena", "unica"): ("MEDIALUNA_RELLENA", ["RM_PIS"]),
    ("roll de canela sin cobertura", "unica"): ("ROLL", []),
    ("roll de canela con cobertura", "unica"): ("ROLL_COBERTURA", ["RC_NUT"]),
    ("torta marmolada", "unica"): ("TORTA_MARMOLADA", []),
    ("torta de banana", "unica"): ("TORTA_BANANA", []),
    ("torta de naranja", "unica"): ("TORTA_NARANJA", []),
    ("carrot cake", "unica"): ("CARROT_CAKE", []),
    ("alfajor de maicena", "unica"): ("ALFAJOR", []),
    ("cookies", "unica"): ("COOKIES", []),
    ("brownie", "unica"): ("BROWNIE", []),
    ("brownie con helado", "unica"): ("BROWNIE_HELADO", []),
    ("limon pie", "unica"): ("LIMON_PIE", []),
    ("tostadas francesas", "unica"): ("TOSTADAS_FRANCESAS", []),
    ("chipa tradicional", "unica"): ("CHIPA", []),
    ("mbeju tradicional", "unica"): ("MBEJU", []),
    ("mbeju jyq", "unica"): ("MBEJU_JYQ", []),
    ("mbeju caprese", "unica"): ("MBEJU_CAPRESE", []),
    ("mixto tradicional", "unica"): ("MIXTO", []),
    ("mixto doble jyq", "unica"): ("MIXTO_DOBLE", []),
    ("mixto capresse", "unica"): ("MIXTO_CAPRESE", []),
    ("huevos revueltos", "unica"): ("HUEVOS_REVUELTOS", []),
    ("omelette jyq", "unica"): ("OMELETTE_JYQ", []),
    ("omelette caprese", "unica"): ("OMELETTE_CAPRESE", []),
    ("empanada al horno", "carne cortada a cuchillo"): ("EMPANADA", ["EM_CAR"]),
    ("empanada al horno", "pollo"): ("EMPANADA", ["EM_POL"]),
    ("empanada al horno", "chilena"): ("EMPANADA", ["EM_CHI"]),
    ("sandwich jyq", "unica"): ("SANDWICH_JYQ", []),
    ("tartas", "caprese"): ("TARTA", ["TA_CAP"]),
    ("tartas", "pollo catupiry"): ("TARTA", ["TA_POL"]),
    ("tartas", "jyq"): ("TARTA", ["TA_JYQ"]),
    ("sandwich de verduras", "unica"): ("SAND_VERDURAS", []),
    ("sandwich de milanesa de carne", "unica"): ("SAND_MILA_CARNE", []),
    ("sandwich de milanesa de pollo", "unica"): ("SAND_MILA_POLLO", []),
    ("sandwich de pollo desmechado", "unica"): ("SAND_POLLO_DES", []),
    ("pizza personal", "unica"): ("PIZZA_PERSONAL", ["PP_MOZ"]),  # duplicado unificado
}
MODIFICADORES = {("agregado de syrup", v): ("G_SYRUP", o) for v, o in [("vainilla", "SY_VAI"), ("chocolate", "SY_CHO"), ("avellanada", "SY_AVE"), ("caramelo", "SY_CAR")]}


def main(xlsx, out):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    ws = wb["Catalogo Mesa Pyae"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    prods = {p[0]: p for p in P}
    opt_delta = {}
    opt_group = {}
    for gid, (gn, mn, mx, ops, nota) in GRUPOS.items():
        for oid, on, d in ops:
            assert oid not in opt_delta, oid
            opt_delta[oid] = d
            opt_group[oid] = gid
    errors, checked = [], 0
    for r in rows:
        if not r or r[1] is None:
            continue
        cat, prod, desc, var, price = r[0], r[1], r[2], r[3], r[4]
        key = (norm(prod), norm(var))
        if key in MODIFICADORES:
            gid, oid = MODIFICADORES[key]
            if opt_delta[oid] != price:
                errors.append(f"Modificador {prod}/{var}: modelo {opt_delta[oid]} != excel {price}")
            checked += 1
            continue
        if key not in MAP:
            errors.append(f"Fila sin mapear: {prod} / {var}")
            continue
        pid, ops = MAP[key]
        base = prods[pid][4]
        for oid in ops:
            if opt_group[oid] not in prods[pid][5]:
                errors.append(f"{pid}: opción {oid} no pertenece a sus grupos")
        calc = base + sum(opt_delta[o] for o in ops)
        if calc != price:
            errors.append(f"{prod} / {var}: modelo {calc} != excel {price}")
        checked += 1
    # Todo producto del modelo debe tener al menos una fila fuente
    used = {v[0] for v in MAP.values()}
    for pid in prods:
        if pid not in used and pid not in P_EXTRA_IDS:
            errors.append(f"Producto del modelo sin fila en Excel: {pid}")
    if errors:
        print("ERRORES:\n" + "\n".join(errors))
        sys.exit(1)

    cat_order = {c[0]: i + 1 for i, c in enumerate(CATEGORIAS)}
    out_obj = {
        "version": "andrade-catalogo-v1",
        "fuente": "Andrade_Casa_Cafe_Catalogo_Mesa_Pyae.xlsx + transcripción fiel de cartas",
        "verificacion": f"{checked} filas del Excel verificadas contra el modelo; 0 diferencias de precio.",
        "categorias": [{"categoria_id": c, "nombre": n, "orden": cat_order[c], "activa": a, "nota": nota} for c, n, a, nota in CATEGORIAS],
        "grupos": [{"grupo_id": g, "nombre": v[0], "min": v[1], "max": v[2], "activo": True, "nota": v[4], "regla": REGLA.get(g, "")} for g, v in GRUPOS.items()],
        "opciones": [{"opcion_id": o, "grupo_id": g, "nombre": n, "delta_gs": d, "activo": True, "orden": i + 1}
                     for g, v in GRUPOS.items() for i, (o, n, d) in enumerate(v[3])],
        "productos": [{"producto_id": p[0], "categoria_id": p[1], "nombre": p[2], "descripcion": p[3], "precio_gs": p[4],
                       "activo": True, "disponible": True, "puntos": "A_CAFE,B_TAKEAWAY", "grupos": ",".join(p[5]),
                       "orden": i + 1, "fuente": p[6], "validacion": PV, "nota": p[7]} for i, p in enumerate(P)],
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(P)} productos, {len(GRUPOS)} grupos, {len(out_obj['opciones'])} opciones. {out_obj['verificacion']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
