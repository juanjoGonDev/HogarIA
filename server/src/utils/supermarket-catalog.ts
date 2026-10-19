/**
 * El pre-registro del inventario (HOGARIA-SPEC ## 12aa): lo que se compra en un supermercado español,
 * catalogado antes de que nadie lo escriba.
 *
 * Por que existe: registrar un producto a mano (nombre, categoria, unidad) es un minuto por ficha, y una casa
 * tarda una tarde entera en tener un inventario que merezca la pena. Aqui llegan 471 productos comunes —los
 * pasillos de Mercadona, Lidl, Consum, Carrefour, Alcampo, Coviran o Dia, sin marcas: lo que hay en la
 * estanteria es generico, la marca es decision (y nota) de la casa—, cada uno con su categoria, y cada
 * categoria con su padre. La relacion producto-categoria-categoria-padre es lo que el visor pinta y lo que
 * `POST /catalog/add` respeta al crear las categorias que a la casa les falten.
 *
 * Por que NO hay tabla: el catalogo es dato de fabrica, como el de utensilios. Copiarlo a una tabla convierte
 * cada producto nuevo en una migracion para actualizar la copia, y no hay nada que editar (las marcas, los
 * precios y los caducan viven en la casa, que es donde cambian). Lo unico que se persiste aqui es lo que la
 * persona anade: una fila de `ingredients` con su categoria.
 *
 * Las once claves de comida `vegetables..beverages` son EXACTAMENTE las de `DEFAULT_PANTRY_CATEGORIES`, y sus
 * etiquetas son las de fabrica de la casa: anadir una leche a una casa con las categorias de siempre cae en su
 * «Lacteos» de siempre (con tilde y todo, porque es la misma cadena), no crea un duplicado con otro nombre.
 * Las demas hojas son nuevas, y `add` las crea con su padre delante (`alimentos`, `limpieza`…).
 *
 * El formato del dato es a proposito `[nombre, unidad]` por fila: un objeto por producto serian 471 repeticiones
 * de tres claves. El id (`hoja:indice`) lo deriva el constructor, y lo que lo mantiene honesto es el test de
 * invariantes (`supermarket-catalog.spec.ts`), no la buena intencion del que escribe.
 */

export type CatalogoCategoria = {
  key: string;
  name: string;
  color: string;
  /** `null` = padre. Toda hoja cuelga de un padre; ningun producto cuelga de un padre. */
  parent: string | null;
};

export type CatalogoProducto = {
  /** `hoja:indice` dentro de la hoja. Referencia efimera: lo que la casa guarda es el nombre. */
  id: string;
  name: string;
  unit: string;
  category: string;
};

/** Los seis pasillos de arriba. Seis, no once: en la pantalla de un movil el arbol se tiene que poder barrer. */
const PADRES: readonly Omit<CatalogoCategoria, 'parent'>[] = [
  { key: 'alimentos', name: 'Alimentos', color: '#E67E22' },
  { key: 'limpieza', name: 'Limpieza del hogar', color: '#4FA3D1' },
  { key: 'higiene', name: 'Higiene personal', color: '#8E5AC8' },
  { key: 'hogar', name: 'Hogar y desechables', color: '#B26A00' },
  { key: 'mascotas', name: 'Mascotas', color: '#2FA79B' },
  { key: 'bebe', name: 'Bebé', color: '#E05A5A' }
];

/**
 * Cada hoja con su etiqueta, su color y su padre. El ORDEN de este objeto es el orden de los pasillos, y las
 * claves son lo que viaja a `ingredients.category`: sin acentos ni espacios, como las de siempre. Las etiquetas
 * si llevan tildes: se leen.
 */
const HOJAS: Readonly<Record<string, { name: string; color: string; parent: string }>> = {
  // Alimentos: las once claves de fabrica de la casa, con su nombre exacto, mas las cinco que pedian hueco.
  vegetables: { name: 'Verduras', color: '#4CAF50', parent: 'alimentos' },
  fruits: { name: 'Frutas', color: '#E05A5A', parent: 'alimentos' },
  meat: { name: 'Carnes', color: '#A6343E', parent: 'alimentos' },
  fish: { name: 'Pescados', color: '#4FA3D1', parent: 'alimentos' },
  charcuteria: { name: 'Charcutería', color: '#C2185B', parent: 'alimentos' },
  dairy: { name: 'Lácteos', color: '#E6C34A', parent: 'alimentos' },
  bakery: { name: 'Panadería', color: '#8D6E63', parent: 'alimentos' },
  grains: { name: 'Cereales', color: '#B26A00', parent: 'alimentos' },
  canned: { name: 'Enlatados', color: '#2FA79B', parent: 'alimentos' },
  frozen: { name: 'Congelados', color: '#6C8AE4', parent: 'alimentos' },
  spices: { name: 'Especias', color: '#8E5AC8', parent: 'alimentos' },
  condiments: { name: 'Condimentos', color: '#C99A2E', parent: 'alimentos' },
  breakfast: { name: 'Desayunos y meriendas', color: '#795548', parent: 'alimentos' },
  snacks: { name: 'Aperitivos y snacks', color: '#F57C00', parent: 'alimentos' },
  sweets: { name: 'Dulces y postres', color: '#AD1457', parent: 'alimentos' },
  beverages: { name: 'Bebidas', color: '#5C6BC0', parent: 'alimentos' },
  // Limpieza del hogar
  colada: { name: 'Colada y lavadora', color: '#0288D1', parent: 'limpieza' },
  fregadero: { name: 'Fregadero y lavavajillas', color: '#00897B', parent: 'limpieza' },
  superficies: { name: 'Superficies y suelos', color: '#5C6BC0', parent: 'limpieza' },
  bano: { name: 'Baño y desincrustantes', color: '#26A69A', parent: 'limpieza' },
  // Higiene personal
  cabello: { name: 'Cuidado del pelo', color: '#7E57C2', parent: 'higiene' },
  corporal: { name: 'Cuidado corporal', color: '#EC407A', parent: 'higiene' },
  bucal: { name: 'Higiene bucal', color: '#29B6F6', parent: 'higiene' },
  botiquin: { name: 'Botiquín', color: '#EF5350', parent: 'higiene' },
  // Hogar y desechables
  desechables: { name: 'Papel y desechables', color: '#8A8F98', parent: 'hogar' },
  almacenaje: { name: 'Almacenaje', color: '#6D4C41', parent: 'hogar' },
  mantenimiento: { name: 'Mantenimiento del hogar', color: '#546E7A', parent: 'hogar' },
  // Mascotas
  perro: { name: 'Perro', color: '#8D6E63', parent: 'mascotas' },
  gato: { name: 'Gato', color: '#A1887F', parent: 'mascotas' },
  // Bebe
  panales: { name: 'Pañales y toallitas', color: '#F48FB1', parent: 'bebe' },
  'alimentacion-bebe': { name: 'Alimentación del bebé', color: '#FFB74D', parent: 'bebe' },
  'cuidado-bebe': { name: 'Cuidado del bebé', color: '#90CAF9', parent: 'bebe' }
};

/**
 * Las filas del pasillo, en su orden de estanteria. Unidad del vocabulario de siempre: `unit` es la unidad de
 * cuenta de la casa (el brik, la caja, el pack de seis), que es como se gestiona un inventario.
 */
const PRODUCTOS_POR_HOJA: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  vegetables: [
    ['Patata', 'kg'],
    ['Patata nueva', 'kg'],
    ['Boniato', 'kg'],
    ['Cebolla', 'kg'],
    ['Cebolleta', 'unit'],
    ['Puerro', 'unit'],
    ['Ajo', 'unit'],
    ['Tomate de ensalada', 'kg'],
    ['Tomate de rama', 'kg'],
    ['Tomate cherry', 'unit'],
    ['Zanahoria', 'kg'],
    ['Remolacha', 'unit'],
    ['Nabo', 'unit'],
    ['Calabaza', 'kg'],
    ['Lechuga iceberg', 'unit'],
    ['Lechuga romana', 'unit'],
    ['Lechuga hoja de roble', 'unit'],
    ['Escarola', 'unit'],
    ['Rúcula', 'unit'],
    ['Espinacas frescas', 'unit'],
    ['Acelgas', 'bunch'],
    ['Brócoli', 'unit'],
    ['Coliflor', 'unit'],
    ['Repollo', 'unit'],
    ['Col de Bruselas', 'unit'],
    ['Judías verdes', 'kg'],
    ['Guisantes frescos', 'kg'],
    ['Espárragos verdes', 'bunch'],
    ['Alcachofa', 'unit'],
    ['Pimiento verde', 'kg'],
    ['Pimiento rojo', 'kg'],
    ['Pimiento italiano', 'kg'],
    ['Pimiento de padrón', 'kg'],
    ['Calabacín', 'kg'],
    ['Berenjena', 'kg'],
    ['Pepino', 'kg'],
    ['Champiñón laminado', 'unit'],
    ['Setas de temporada', 'unit'],
    ['Perejil fresco', 'bunch'],
    ['Cilantro fresco', 'bunch']
  ],
  fruits: [
    ['Plátano de Canarias', 'kg'],
    ['Manzana Golden', 'kg'],
    ['Manzana Fuji', 'kg'],
    ['Manzana Granny Smith', 'kg'],
    ['Pera Conferencia', 'kg'],
    ['Naranja de zumo', 'kg'],
    ['Naranja de mesa', 'kg'],
    ['Mandarina', 'kg'],
    ['Clementina', 'kg'],
    ['Limón', 'kg'],
    ['Lima', 'unit'],
    ['Kiwi', 'kg'],
    ['Fresón', 'unit'],
    ['Arándanos', 'unit'],
    ['Frambuesa', 'unit'],
    ['Moras', 'unit'],
    ['Uva blanca', 'kg'],
    ['Uva negra', 'kg'],
    ['Sandía', 'unit'],
    ['Sandía baby', 'unit'],
    ['Melón Piel de Sapo', 'unit'],
    ['Melón Galia', 'unit'],
    ['Cereza', 'kg'],
    ['Ciruela roja', 'kg'],
    ['Melocotón amarillo', 'kg'],
    ['Paraguayo', 'kg'],
    ['Nectarina', 'kg'],
    ['Aguacate', 'unit'],
    ['Mango', 'unit'],
    ['Piña', 'unit'],
    ['Papaya', 'unit'],
    ['Granada', 'unit'],
    ['Higo', 'unit'],
    ['Chirimoya', 'unit']
  ],
  meat: [
    ['Pechuga de pollo', 'kg'],
    ['Pollo entero', 'unit'],
    ['Muslos de pollo', 'kg'],
    ['Contramuslos de pollo', 'kg'],
    ['Alitas de pollo', 'kg'],
    ['Filetes de pollo', 'kg'],
    ['Filetes de pavo', 'kg'],
    ['Pechuga de pavo', 'kg'],
    ['Carne picada de ternera', 'kg'],
    ['Carne picada mixta', 'kg'],
    ['Hamburguesa de ternera', 'unit'],
    ['Hamburguesa de pollo', 'unit'],
    ['Filete de ternera', 'kg'],
    ['Ternera para guisar', 'kg'],
    ['Carrillera de cerdo', 'kg'],
    ['Solomillo de cerdo', 'kg'],
    ['Chuletas de cerdo', 'kg'],
    ['Lomo de cerdo en filetes', 'kg'],
    ['Secreto ibérico', 'kg'],
    ['Presa ibérica', 'kg'],
    ['Costilla de cerdo', 'kg'],
    ['Bacon loncheado', 'unit'],
    ['Salchichas de pollo', 'unit'],
    ['Paletilla de cordero', 'kg'],
    ['Chuletillas de cordero', 'kg']
  ],
  fish: [
    ['Merluza en rodajas', 'kg'],
    ['Lomos de merluza', 'kg'],
    ['Salmón en lomo', 'kg'],
    ['Atún en lomos', 'kg'],
    ['Trucha', 'kg'],
    ['Bacaladilla', 'kg'],
    ['Boquerones', 'kg'],
    ['Sardinas', 'kg'],
    ['Dorada', 'unit'],
    ['Lubina', 'unit'],
    ['Rape', 'kg'],
    ['Rodaballo', 'unit'],
    ['Besugo', 'unit'],
    ['Corvina', 'unit'],
    ['Mejillón', 'kg'],
    ['Almejas', 'unit'],
    ['Gambas', 'kg'],
    ['Langostinos', 'kg'],
    ['Cigalas', 'kg'],
    ['Calamar limpio', 'kg'],
    ['Sepia', 'kg'],
    ['Pulpo', 'kg']
  ],
  charcuteria: [
    ['Jamón serrano loncheado', 'unit'],
    ['Jamón cocido extra', 'unit'],
    ['Pechuga de pavo fiambre', 'unit'],
    ['Paleta serrana', 'unit'],
    ['Chorizo curado', 'unit'],
    ['Salchichón curado', 'unit'],
    ['Fuet curado', 'unit'],
    ['Longaniza', 'unit'],
    ['Sobrasada', 'unit'],
    ['Morcilla de cebolla', 'unit'],
    ['Lomo embuchado', 'unit'],
    ['Cecina de León', 'unit']
  ],
  dairy: [
    ['Leche entera', 'l'],
    ['Leche semidesnatada', 'l'],
    ['Leche desnatada', 'l'],
    ['Leche sin lactosa', 'l'],
    ['Leche de avena', 'l'],
    ['Leche de soja', 'l'],
    ['Leche de almendras', 'l'],
    ['Batido de chocolate', 'unit'],
    ['Nata para cocinar', 'ml'],
    ['Nata para montar', 'ml'],
    ['Mantequilla con sal', 'g'],
    ['Mantequilla sin sal', 'g'],
    ['Margarina', 'g'],
    ['Queso fresco', 'unit'],
    ['Queso tierno', 'unit'],
    ['Queso semicurado', 'unit'],
    ['Queso curado', 'unit'],
    ['Queso manchego curado', 'unit'],
    ['Queso de cabra', 'unit'],
    ['Queso rallado para pizza', 'g'],
    ['Queso rallado mezcla', 'g'],
    ['Mozzarella fresca', 'unit'],
    ['Queso untable', 'unit'],
    ['Yogur natural', 'unit'],
    ['Yogur de frutas', 'unit'],
    ['Yogur griego', 'unit'],
    ['Yogur de proteína', 'unit'],
    ['Kéfir', 'unit'],
    ['Huevos blancos M', 'unit'],
    ['Huevos blancos L', 'unit'],
    ['Huevos camperos M', 'unit'],
    ['Huevos camperos L', 'unit']
  ],
  bakery: [
    ['Barra de pan', 'unit'],
    ['Hogaza de pan de pueblo', 'unit'],
    ['Pan de molde blanco', 'unit'],
    ['Pan de molde integral', 'unit'],
    ['Pan multicereales', 'unit'],
    ['Pan de semillas', 'unit'],
    ['Pan de hamburguesa', 'unit'],
    ['Pan de perritos', 'unit'],
    ['Picos camperos', 'unit'],
    ['Napolitana de chocolate', 'unit'],
    ['Palmera de hojaldre', 'unit'],
    ['Croissant de mantequilla', 'unit']
  ],
  grains: [
    ['Arroz redondo', 'kg'],
    ['Arroz largo', 'kg'],
    ['Arroz basmati', 'kg'],
    ['Arroz bomba', 'kg'],
    ['Espaguetis', 'kg'],
    ['Macarrones', 'kg'],
    ['Tallarines', 'kg'],
    ['Fusilli', 'kg'],
    ['Lenteja pardina', 'kg'],
    ['Garbanzos secos', 'kg'],
    ['Alubia blanca', 'kg'],
    ['Cuscús', 'g'],
    ['Avena en copos', 'g'],
    ['Harina de trigo', 'kg'],
    ['Harina para freír', 'kg'],
    ['Maicena', 'g'],
    ['Levadura química', 'g'],
    ['Pan rallado', 'kg'],
    ['Azúcar blanco', 'kg'],
    ['Azúcar moreno', 'kg']
  ],
  canned: [
    ['Atún en aceite de girasol', 'unit'],
    ['Atún en aceite de oliva', 'unit'],
    ['Atún al natural', 'unit'],
    ['Bonito del Norte en aceite', 'unit'],
    ['Sardinas en aceite', 'unit'],
    ['Mejillones en escabeche', 'unit'],
    ['Caballa en aceite', 'unit'],
    ['Anchoas en aceite', 'unit'],
    ['Berberechos', 'unit'],
    ['Pimientos del piquillo', 'unit'],
    ['Alcachofas en conserva', 'unit'],
    ['Champiñones fileteados en conserva', 'unit'],
    ['Guisantes extrafinos', 'unit'],
    ['Maíz dulce', 'unit'],
    ['Tomate triturado', 'unit'],
    ['Garbanzos cocidos', 'unit'],
    ['Lentejas cocidas', 'unit'],
    ['Alubias cocidas', 'unit'],
    ['Leche condensada', 'unit'],
    ['Leche evaporada', 'unit']
  ],
  frozen: [
    ['Guisantes congelados', 'kg'],
    ['Judías verdes congeladas', 'kg'],
    ['Espinacas congeladas', 'kg'],
    ['Brócoli congelado', 'kg'],
    ['Menestra de verduras', 'kg'],
    ['Verdura salteada', 'kg'],
    ['Patata gajo', 'kg'],
    ['Patata bastón', 'kg'],
    ['Croqueta cocida', 'unit'],
    ['Nuggets de pollo', 'unit'],
    ['Pescado rebozado', 'unit'],
    ['Pizza jamón y queso', 'unit'],
    ['Pizza cuatro quesos', 'unit'],
    ['Lasaña boloñesa', 'unit'],
    ['Tarrina de helado de vainilla', 'unit'],
    ['Sorbete de limón', 'unit']
  ],
  spices: [
    ['Sal fina', 'g'],
    ['Sal gorda', 'g'],
    ['Pimienta negra molida', 'g'],
    ['Pimienta negra en grano', 'g'],
    ['Pimentón de la Vera dulce', 'g'],
    ['Pimentón de la Vera picante', 'g'],
    ['Orégano', 'g'],
    ['Laurel', 'unit'],
    ['Comino molido', 'g'],
    ['Curry', 'g'],
    ['Canela molida', 'g'],
    ['Nuez moscada', 'g'],
    ['Ajo en polvo', 'g'],
    ['Jengibre molido', 'g'],
    ['Perejil deshidratado', 'g'],
    ['Azafrán en sobres', 'unit']
  ],
  condiments: [
    ['Aceite de oliva virgen extra', 'l'],
    ['Garrafa de aceite de oliva 5 L', 'unit'],
    ['Aceite de orujo de oliva', 'l'],
    ['Aceite de girasol', 'l'],
    ['Vinagre de vino tinto', 'ml'],
    ['Vinagre de Módena', 'ml'],
    ['Mayonesa', 'unit'],
    ['Salsa kétchup', 'unit'],
    ['Mostaza', 'unit'],
    ['Mostaza a la antigua', 'unit'],
    ['Salsa de soja', 'ml'],
    ['Salsa picante', 'unit'],
    ['Salsa brava', 'unit'],
    ['Alioli', 'unit'],
    ['Tomate frito', 'unit'],
    ['Salsa mostaza y miel', 'unit']
  ],
  breakfast: [
    ['Café molido natural', 'g'],
    ['Café molido torrefacto', 'g'],
    ['Café descafeinado molido', 'g'],
    ['Café soluble', 'unit'],
    ['Cápsulas de café', 'unit'],
    ['Cacao en polvo', 'g'],
    ['Chocolate a la taza en polvo', 'g'],
    ['Crema de cacao y avellanas', 'unit'],
    ['Miel de flores', 'g'],
    ['Mermelada de fresa', 'unit'],
    ['Mermelada de naranja amarga', 'unit'],
    ['Galletas María', 'unit'],
    ['Galletas de avena', 'unit'],
    ['Cereales de desayuno azucarados', 'unit'],
    ['Barritas de cereales', 'unit'],
    ['Donut de chocolate', 'unit'],
    ['Bollycao de chocolate', 'unit']
  ],
  snacks: [
    ['Patatas fritas', 'unit'],
    ['Bolsa familiar de patatas fritas', 'unit'],
    ['Nachos de maíz', 'unit'],
    ['Palomitas para microondas', 'unit'],
    ['Frutos secos fritos', 'unit'],
    ['Almendras fritas', 'unit'],
    ['Cacahuetes con sal', 'unit'],
    ['Pipas de girasol', 'unit'],
    ['Mezcla tropical', 'unit'],
    ['Aceituna manzanilla', 'unit'],
    ['Aceituna rellena de anchoa', 'unit'],
    ['Aceituna aliñada', 'unit'],
    ['Pepinillos en vinagre', 'unit'],
    ['Guindillas en vinagre', 'unit']
  ],
  sweets: [
    ['Chocolate con leche en tableta', 'g'],
    ['Chocolate negro en tableta', 'g'],
    ['Bombones', 'unit'],
    ['Turrón duro de Alicante', 'unit'],
    ['Turrón blando de Jijona', 'unit'],
    ['Polvorón', 'unit'],
    ['Flan napolitano', 'unit'],
    ['Natillas de vainilla', 'unit'],
    ['Arroz con leche', 'unit'],
    ['Gominolas', 'unit'],
    ['Regalices', 'unit'],
    ['Membrillo en barra', 'unit'],
    ['Chispas de chocolate', 'g']
  ],
  beverages: [
    ['Agua mineral natural', 'unit'],
    ['Agua con gas', 'unit'],
    ['Agua sin gas garrafa 5 L', 'unit'],
    ['Refresco de limón', 'unit'],
    ['Refresco de naranja', 'unit'],
    ['Refresco de cola', 'unit'],
    ['Refresco de cola zero', 'unit'],
    ['Tónica', 'unit'],
    ['Gaseosa', 'unit'],
    ['Té frío de limón', 'unit'],
    ['Zumo de naranja', 'l'],
    ['Zumo de piña', 'l'],
    ['Zumo multifrutas', 'l'],
    ['Cerveza 33 cl', 'unit'],
    ['Cerveza de maíz 1 L', 'unit'],
    ['Cerveza sin alcohol', 'unit'],
    ['Vino tinto joven', 'unit'],
    ['Vino tinto crianza', 'unit'],
    ['Vino blanco', 'unit'],
    ['Vino rosado', 'unit'],
    ['Cava brut', 'unit'],
    ['Vermut rojo', 'unit'],
    ['Sangría', 'unit'],
    ['Tinto de verano', 'unit'],
    ['Bebida energética', 'unit']
  ],
  colada: [
    ['Detergente líquido de lavadora', 'unit'],
    ['Detergente en polvo de lavadora', 'unit'],
    ['Cápsulas de detergente', 'unit'],
    ['Suavizante de tejidos', 'unit'],
    ['Quitamanchas en spray', 'unit'],
    ['Lejía con espesante', 'unit'],
    ['Percarbonato de sodio', 'g'],
    ['Limpiador de lavadoras', 'unit']
  ],
  fregadero: [
    ['Lavavajillas a mano', 'unit'],
    ['Lavavajillas en pastillas para lavavajillas', 'unit'],
    ['Lavavajillas en gel para lavavajillas', 'unit'],
    ['Abrillantador para lavavajillas', 'unit'],
    ['Sal para lavavajillas', 'g'],
    ['Estropajo con jabón', 'unit'],
    ['Bayetas de microfibra', 'unit'],
    ['Guantes de fregar', 'unit']
  ],
  superficies: [
    ['Limpiador multiusos', 'unit'],
    ['Limpiacristales', 'unit'],
    ['Desengrasante de cocina', 'unit'],
    ['Limpiasuelos', 'unit'],
    ['Cera para suelos', 'unit'],
    ['Limpiahornos y antigrasa', 'unit'],
    ['Ambientador en spray', 'unit'],
    ['Limpiamuebles', 'unit'],
    ['Fregona de microfibra', 'unit']
  ],
  bano: [
    ['Limpiador de baño', 'unit'],
    ['Antical para baño', 'unit'],
    ['Piedra abrasiva', 'unit'],
    ['Gel limpiador de inodoros', 'unit'],
    ['Pastillas para la cisterna', 'unit'],
    ['Desatascador líquido', 'unit'],
    ['Escobilla de baño', 'unit'],
    ['Paperera con tapa', 'unit']
  ],
  cabello: [
    ['Champú diario', 'unit'],
    ['Champú de reparación', 'unit'],
    ['Champú anticaspa', 'unit'],
    ['Champú en seco', 'unit'],
    ['Acondicionador', 'unit'],
    ['Mascarilla capilar', 'unit'],
    ['Laca fijadora', 'unit'],
    ['Cera de peinar', 'unit']
  ],
  corporal: [
    ['Gel de baño hidratante', 'unit'],
    ['Jabón de tocador', 'unit'],
    ['Gel antibacterial de manos', 'unit'],
    ['Desodorante roll-on', 'unit'],
    ['Desodorante en spray', 'unit'],
    ['Crema hidratante corporal', 'unit'],
    ['Crema de manos', 'unit'],
    ['Protector solar factor 30', 'unit'],
    ['Protector solar factor 50', 'unit'],
    ['Jabón íntimo', 'unit'],
    ['Bálsamo labial', 'unit']
  ],
  bucal: [
    ['Pasta dentífrica fluorada', 'unit'],
    ['Pasta dentífrica blanqueante', 'unit'],
    ['Colutorio antiséptico', 'unit'],
    ['Colutorio sin alcohol', 'unit'],
    ['Hilo dental', 'unit'],
    ['Cepillo de dientes medio', 'unit'],
    ['Cepillo de dientes eléctrico', 'unit'],
    ['Cepillos interdentales', 'unit']
  ],
  botiquin: [
    ['Tiritas surtidas', 'unit'],
    ['Desinfectante cutáneo', 'unit'],
    ['Alcohol de 96', 'unit'],
    ['Vendas de gasa', 'unit'],
    ['Esparadrapo', 'unit'],
    ['Termómetro digital', 'unit'],
    ['Suero oral', 'unit'],
    ['Hielo instantáneo', 'unit']
  ],
  desechables: [
    ['Papel higiénico', 'unit'],
    ['Papel de cocina', 'unit'],
    ['Papel de aluminio', 'unit'],
    ['Film transparente', 'unit'],
    ['Papel de horno', 'unit'],
    ['Bolsas de basura pequeñas', 'unit'],
    ['Bolsas de basura grandes', 'unit'],
    ['Bolsas con cierre hermético', 'unit'],
    ['Vasos de papel', 'unit'],
    ['Platos de cartón', 'unit'],
    ['Cubiertos de plástico', 'unit'],
    ['Servilletas de papel', 'unit'],
    ['Guantes de nitrilo', 'unit']
  ],
  almacenaje: [
    ['Cajas de almacenaje', 'unit'],
    ['Caja de reciclaje plegable', 'unit'],
    ['Perchas antivuelo', 'unit'],
    ['Bolsas de vacío para ropa', 'unit'],
    ['Botes herméticos de cristal', 'unit'],
    ['Tuppers apilables', 'unit'],
    ['Zapatero de tela', 'unit'],
    ['Organizador de cajones', 'unit']
  ],
  mantenimiento: [
    ['Bombillas led', 'unit'],
    ['Pilas alcalinas AA', 'unit'],
    ['Pilas alcalinas AAA', 'unit'],
    ['Cinta adhesiva universal', 'unit'],
    ['Cinta de carrocero', 'unit'],
    ['Kit de costura', 'unit'],
    ['Velas aromáticas', 'unit'],
    ['Flexo de lámpara', 'unit']
  ],
  perro: [
    ['Pienso de perro adulto pollo y arroz', 'unit'],
    ['Pienso de cachorro', 'unit'],
    ['Lata de perro en salsa', 'unit'],
    ['Sobres de perro', 'unit'],
    ['Snacks dentales para perro', 'unit'],
    ['Bolsas higiénicas para pasear', 'unit'],
    ['Empapadores para cachorro', 'unit'],
    ['Champú para perro', 'unit']
  ],
  gato: [
    ['Pienso de gato adulto salmón', 'unit'],
    ['Pienso de gato esterilizado', 'unit'],
    ['Sobres de gato en salsa', 'unit'],
    ['Lata de gato con atún', 'unit'],
    ['Arena aglomerante para gato', 'kg'],
    ['Arena de sílice para gato', 'kg'],
    ['Snacks para gato', 'unit'],
    ['Rascador para gato', 'unit']
  ],
  panales: [
    ['Pañales talla 0 recién nacido', 'unit'],
    ['Pañales talla 1', 'unit'],
    ['Pañales talla 2', 'unit'],
    ['Pañales talla 3', 'unit'],
    ['Pañales talla 4', 'unit'],
    ['Pañales talla 5', 'unit'],
    ['Pañales talla 6', 'unit'],
    ['Empapadores de cambiador', 'unit']
  ],
  'alimentacion-bebe': [
    ['Leche de inicio 1', 'unit'],
    ['Leche de continuación 2', 'unit'],
    ['Leche de crecimiento 3', 'unit'],
    ['Leche sin lactosa para bebés', 'unit'],
    ['Papilla de cereales sin gluten', 'unit'],
    ['Potito de fruta manzana-pera', 'unit'],
    ['Potito de verdura con pollo', 'unit'],
    ['Potito de merluza con verdura', 'unit']
  ],
  'cuidado-bebe': [
    ['Gel de baño suave de bebé', 'unit'],
    ['Crema protectora del pañal', 'unit'],
    ['Leche hidratante de bebé', 'unit'],
    ['Agua micelar para bebé', 'unit'],
    ['Toallitas de bebé sin perfume', 'unit'],
    ['Chupete 0-6 meses', 'unit'],
    ['Biberón anticólicos', 'unit'],
    ['Termómetro de baño para bebé', 'unit']
  ]
};

/** Claves de los seis padres, para poder preguntar «esto es padre» sin recorrer la lista. */
export const PARENT_KEYS: ReadonlySet<string> = new Set(PADRES.map((padre) => padre.key));

export const CATALOGO_CATEGORIAS: readonly CatalogoCategoria[] = [
  ...PADRES.map((padre) => ({ ...padre, parent: null })),
  ...Object.entries(HOJAS).map(([key, hoja]) => ({ key, name: hoja.name, color: hoja.color, parent: hoja.parent }))
];

const PRODUCTOS_POR_CLAVE = new Map<string, CatalogoProducto>();

export const CATALOGO_PRODUCTOS: readonly CatalogoProducto[] = Object.entries(PRODUCTOS_POR_HOJA).flatMap(
  ([hoja, filas]) =>
    filas.map((fila, index): CatalogoProducto => {
      const producto: CatalogoProducto = {
        id: `${hoja}:${index}`,
        name: String(fila[0]).replace(/\s+/g, ' ').trim(),
        unit: String(fila[1]),
        category: hoja
      };
      PRODUCTOS_POR_CLAVE.set(producto.id, producto);
      return producto;
    })
);

/** El id lo monta el constructor de arriba; esto es la unica lectura. Un id basura no existe, y ya. */
export function productoPorId(id: string | null | undefined): CatalogoProducto | undefined {
  if (!id) return undefined;
  return PRODUCTOS_POR_CLAVE.get(id);
}

export function esHoja(key: string): boolean {
  return Boolean(HOJAS[key]) && !PARENT_KEYS.has(key);
}

/** Hojas de una clave: ella misma si es hoja, sus hijos si es padre, nada si no la conoce nadie. */
export function hojasDe(key: string | null | undefined): string[] {
  if (!key) return Object.keys(HOJAS);
  if (esHoja(key)) return [key];
  if (PARENT_KEYS.has(key)) return Object.keys(HOJAS).filter((hoja) => HOJAS[hoja].parent === key);
  return [];
}

/** Normalizacion de busqueda: la misma idea que `pantryCategoryKey` —minusculas y sin acentos—. */
export function normalizarBusqueda(valor: string): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cuantos productos hay en cada hoja (y `0` en las que se quedaran vacias: un padre sin cuenta no es un dato). */
export function conteoPorHoja(): Map<string, number> {
  const conteo = new Map<string, number>(Object.keys(HOJAS).map((hoja) => [hoja, 0]));
  for (const producto of CATALOGO_PRODUCTOS) conteo.set(producto.category, (conteo.get(producto.category) ?? 0) + 1);
  return conteo;
}

export type BusquedaCatalogo = {
  q?: string;
  /** Hoja o padre; con padre se responde el subarbol entero. */
  category?: string;
  limit: number;
  offset: number;
};

const ORDEN_HOJAS = new Map(Object.keys(HOJAS).map((hoja, index) => [hoja, index]));

/**
 * Busca en el catalogo: subarbol, texto normalizado y orden estable (hoja en orden de pasillo, nombre en
 * espanol). Devuelve la pagina y el total del filtro, que es lo que la pantalla necesita para el paginador.
 */
export function buscarProductos(consulta: BusquedaCatalogo): { productos: readonly CatalogoProducto[]; total: number } {
  const permitidas = new Set(hojasDe(consulta.category ?? null));
  const texto = normalizarBusqueda(consulta.q ?? '');
  const filtrados = CATALOGO_PRODUCTOS.filter((producto) => {
    if (!permitidas.has(producto.category)) return false;
    return !texto || normalizarBusqueda(producto.name).includes(texto);
  });
  const ordenados = [...filtrados].sort((a, b) => {
    const porHoja = (ORDEN_HOJAS.get(a.category) ?? 0) - (ORDEN_HOJAS.get(b.category) ?? 0);
    return porHoja !== 0 ? porHoja : a.name.localeCompare(b.name, 'es');
  });
  const desde = Math.max(0, Math.floor(consulta.offset || 0));
  return {
    productos: ordenados.slice(desde, desde + Math.max(1, Math.floor(consulta.limit || 24))),
    total: ordenados.length
  };
}
