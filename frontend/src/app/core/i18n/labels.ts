import type { MealType } from '../../shared/models/calendar.model';
import type { TranslationKey } from './index';
import type { ListEventAction } from '../../shared/models/shopping.model';

// =============================================================================
// De un dato guardado a la clave que lo ensena.
//
// El problema: `MEAL_TYPE_META[type].label` es espanol y viaja al prompt de la IA, asi que no se puede
// traducir ahi (se romperia el contrato, ver HOGARIA-SPEC §12s-A), pero es exactamente esa cadena la que
// cuatro pantallas pintan. La solucion es separar las dos cosas: el dato sigue siendo el dato, y lo que
// se ensena se busca aqui.
//
// El mapa esta tipado a `TranslationKey`, que es la lista real de claves: borrar `meal.snack` del
// diccionario se nota en compilacion, y una clave inventada tambien.
// =============================================================================

/** Como se ensena cada comida, en el idioma activo. */
export const MEAL_LABEL_KEYS: Record<MealType, TranslationKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  snack: 'meal.snack',
  dinner: 'meal.dinner'
};

/**
 * Los gustos y alergias del catalogo del onboarding. Lo que se **guarda** es el texto en castellano (viaja al
 * prompt y lo escribe la IA al releer la lista), asi que no se puede traducir el dato: se traduce lo que se
 * ensena, y solo cuando la cadena es una de las opciones conocidas. Lo que alguien escribio a mano se pinta
 * tal cual, porque es su texto y la pantalla no tiene derecho a corregirlo (HOGARIA-SPEC ## 12u).
 */
export const TASTE_VALUE_LABEL_KEYS: Record<string, TranslationKey> = {
  'Gluten': 'taste.gluten',
  'Lactosa': 'taste.lactosa',
  'Huevo': 'taste.huevo',
  'Pescado': 'taste.pescado',
  'Marisco': 'taste.marisco',
  'Moluscos': 'taste.moluscos',
  'Frutos secos': 'taste.frutos_secos',
  'Cacahuete': 'taste.cacahuete',
  'Soja': 'taste.soja',
  'Sésamo': 'taste.sesamo',
  'Mostaza': 'taste.mostaza',
  'Apio': 'taste.apio',
  'Sulfitos': 'taste.sulfitos',
  'Altramuces': 'taste.altramuces',
  'Cebolleta/Ajo': 'taste.cebolleta_ajo',
  'Sin cerdo': 'taste.sin_cerdo',
  'Sin alcohol': 'taste.sin_alcohol',
  'Vegetariano': 'taste.vegetariano',
  'Vegano': 'taste.vegano',
  'Pollo': 'taste.pollo',
  'Pavo': 'taste.pavo',
  'Pescado al horno': 'taste.pescado_al_horno',
  'Verduras': 'taste.verduras',
  'Ensaladas': 'taste.ensaladas',
  'Legumbres': 'taste.legumbres',
  'Arroz': 'taste.arroz',
  'Pasta': 'taste.pasta',
  'Patata': 'taste.patata',
  'Huevos': 'taste.huevos',
  'Queso': 'taste.queso',
  'Fruta': 'taste.fruta',
  'Sopas y cremas': 'taste.sopas_y_cremas',
  'Cocina española': 'taste.cocina_espanola',
  'Cocina italiana': 'taste.cocina_italiana',
  'Cocina asiática': 'taste.cocina_asiatica',
  'Cocina mexicana': 'taste.cocina_mexicana',
  'Picante': 'taste.picante',
  'A la plancha': 'taste.a_la_plancha',
  'Al horno': 'taste.al_horno',
  'En airfryer': 'taste.en_airfryer',
  'Postres': 'taste.postres',
  'Desayunos salados': 'taste.desayunos_salados',
  'Cocina de aprovechamiento': 'taste.cocina_de_aprovechamiento',
  'Vísceras y casquería': 'taste.visceras_y_casqueria',
  'Anchoas y boquerones': 'taste.anchoas_y_boquerones',
  'Sardinas': 'taste.sardinas',
  'Aceitunas': 'taste.aceitunas',
  'Alcaparras': 'taste.alcaparras',
  'Cilantro': 'taste.cilantro',
  'Menta': 'taste.menta',
  'Regaliz': 'taste.regaliz',
  'Brócoli y coliflor': 'taste.brocoli_y_coliflor',
  'Coles de Bruselas': 'taste.coles_de_bruselas',
  'Espinacas': 'taste.espinacas',
  'Setas y champiñones': 'taste.setas_y_champinones',
  'Calabacín y berenjena': 'taste.calabacin_y_berenjena',
  'Nabo y chirivía': 'taste.nabo_y_chirivia',
  'Pepino': 'taste.pepino',
  'Pimientos asados': 'taste.pimientos_asados',
  'Pasas y fruta pasada': 'taste.pasas_y_fruta_pasada',
  'Muy picante': 'taste.muy_picante',
  'Muy dulce': 'taste.muy_dulce',
  'Fritos': 'taste.fritos',
  'Nata y queso crema': 'taste.nata_y_queso_crema',
  'Crudos (sashimi, steak tartar)': 'taste.crudos_sashimi_steak_tartar',
};

/** La etiqueta de un valor del perfil de gustos, en el idioma activo; `null` si no es del catalogo. */
export function tasteLabelKey(value: string): TranslationKey | null {
  return TASTE_VALUE_LABEL_KEYS[value] ?? null;
}

/**
 * Las categorias de las listas de la compra, igual que los gustos: el valor se guarda y se canoniza
 * en castellano (historial, stats, la IA), y lo unico que puede cambiar de idioma es la etiqueta.
 * «En el carro» no es una categoria del modelo, es el titulo del grupo cuando se mira la pestana de
 * lo ya comprado, y tambien pasa por aqui para no tener una regla especial en la pantalla.
 */
export const LIST_CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  'Frutas y verduras': 'shopping_lists.categoria_frutas_verduras',
  'Carnes y pescados': 'shopping_lists.categoria_carnes_pescados',
  'Lacteos': 'shopping_lists.categoria_lacteos',
  'Despensa': 'shopping_lists.categoria_despensa',
  'Higiene y limpieza': 'shopping_lists.categoria_higiene_limpieza',
  'Bebidas y alcohol': 'shopping_lists.categoria_bebidas_alcohol',
  'Mascotas': 'shopping_lists.categoria_mascotas',
  'Congelados': 'shopping_lists.categoria_congelados',
  'Otros': 'shopping_lists.categoria_otros',
  'En el carro': 'shopping_list_detail.en_el_carro'
};

/** Etiqueta de una categoria de lista; `null` si no es una categoria conocida. */
export function listCategoryLabelKey(value: string): TranslationKey | null {
  return LIST_CATEGORY_LABEL_KEYS[value] ?? null;
}

/**
 * El historial de la lista de la compra, accion por accion (HOGARIA-SPEC ## 12w).
 *
 * El server guarda `action` e `item_name`, y en castellano ademas manda la frase ya escrita (`description`) para
 * que un cliente que no la traduzca no se quede en blanco. Aqui no se pinta esa frase: se compone la del idioma
 * activo, con el nombre de la persona y el del articulo como parametros. `Record<ListEventAction, ...>` es parte
 * del arreglo: si el server anade una accion, el diccionario del cliente no compila hasta que alguien la escriba,
 * y el espejo `server/src/utils/shopping-list-event-i18n.spec.ts` es el que obliga a que la union diga las
 * acciones de verdad y no las nueve inventadas que decia antes.
 */
export const LIST_EVENT_LABEL_KEYS: Record<ListEventAction, TranslationKey> = {
  'list.create': 'list_event.lista_creada',
  'list.update': 'list_event.lista_cambiada',
  'list.complete': 'list_event.compra_terminada',
  'list.reopen': 'list_event.lista_reabierta',
  'list.delete': 'list_event.lista_borrada',
  'list.discount': 'list_event.descuento_cambiado',
  'list.discount-remove': 'list_event.descuento_quitado',
  'list.clear-checked': 'list_event.carro_vaciado',
  'list.order': 'list_event.lista_reordenada',
  'item.add': 'list_event.item_anadido',
  'item.merge': 'list_event.item_sumado',
  'item.update': 'list_event.item_editado',
  'item.discount': 'list_event.item_descuento',
  'item.offer': 'list_event.item_oferta',
  'item.check': 'list_event.item_marcada',
  'item.uncheck': 'list_event.item_desmarcada',
  'item.remove': 'list_event.item_quitado',
  'item.restore': 'list_event.item_recuperado',
  'items.bulk': 'list_event.lista_pegada',
  'items.apply': 'list_event.lineas_desde_una_foto'
};

/**
 * Los alimentos que la app siembra en la despensa de una casa nueva (68).
 *
 * La clave es el nombre en castellano que guarda `server/src/utils/seed-data.ts` —lo que hay en la base de datos
 * NO se traduce nunca, porque viaja al prompt de la IA y lo reescribe la propia app al releer la lista— y el
 * valor es la etiqueta que se pinta. Lo que no esta aqui es un nombre que escribio la persona: se pinta tal cual, porque es su texto.
 */
export const FOOD_LABEL_KEYS: Record<string, TranslationKey> = {
  'Patatas': 'pantry.comida.patatas',
  'Cebolla': 'pantry.comida.cebolla',
  'Ajo': 'pantry.comida.ajo',
  'Tomate': 'pantry.comida.tomate',
  'Zanahoria': 'pantry.comida.zanahoria',
  'Pimiento': 'pantry.comida.pimiento',
  'Lechuga': 'pantry.comida.lechuga',
  'Pepino': 'pantry.comida.pepino',
  'Calabacín': 'pantry.comida.calabacin',
  'Berenjena': 'pantry.comida.berenjena',
  'Brócoli': 'pantry.comida.brocoli',
  'Espinacas': 'pantry.comida.espinacas',
  'Plátano': 'pantry.comida.platano',
  'Manzana': 'pantry.comida.manzana',
  'Naranja': 'pantry.comida.naranja',
  'Limón': 'pantry.comida.limon',
  'Fresas': 'pantry.comida.fresas',
  'Uvas': 'pantry.comida.uvas',
  'Aguacate': 'pantry.comida.aguacate',
  'Piña': 'pantry.comida.pina',
  'Melocotón': 'pantry.comida.melocoton',
  'Pera': 'pantry.comida.pera',
  'Huevos': 'pantry.comida.huevos',
  'Pollo': 'pantry.comida.pollo',
  'Carne picada': 'pantry.comida.carne_picada',
  'Ternera': 'pantry.comida.ternera',
  'Cerdo': 'pantry.comida.cerdo',
  'Bacón': 'pantry.comida.bacon',
  'Salmón': 'pantry.comida.salmon',
  'Merluza': 'pantry.comida.merluza',
  'Atún en lata': 'pantry.comida.atun_en_lata',
  'Gambas': 'pantry.comida.gambas',
  'Leche': 'pantry.comida.leche',
  'Queso': 'pantry.comida.queso',
  'Queso rallado': 'pantry.comida.queso_rallado',
  'Yogur': 'pantry.comida.yogur',
  'Mantequilla': 'pantry.comida.mantequilla',
  'Nata': 'pantry.comida.nata',
  'Arroz': 'pantry.comida.arroz',
  'Pasta': 'pantry.comida.pasta',
  'Pan de molde': 'pantry.comida.pan_de_molde',
  'Pan': 'pantry.comida.pan',
  'Harina': 'pantry.comida.harina',
  'Azúcar': 'pantry.comida.azucar',
  'Sal': 'pantry.comida.sal',
  'Pimienta': 'pantry.comida.pimienta',
  'Aceite de oliva': 'pantry.comida.aceite_de_oliva',
  'Vinagre': 'pantry.comida.vinagre',
  'Salsa de tomate': 'pantry.comida.salsa_de_tomate',
  'Mayonesa': 'pantry.comida.mayonesa',
  'Ketchup': 'pantry.comida.ketchup',
  'Mostaza': 'pantry.comida.mostaza',
  'Salsa de soja': 'pantry.comida.salsa_de_soja',
  'Miel': 'pantry.comida.miel',
  'Café': 'pantry.comida.cafe',
  'Té': 'pantry.comida.te',
  'Chocolate': 'pantry.comida.chocolate',
  'Pan rallado': 'pantry.comida.pan_rallado',
  'Levadura': 'pantry.comida.levadura',
  'Garbanzos': 'pantry.comida.garbanzos',
  'Lentejas': 'pantry.comida.lentejas',
  'Alubias': 'pantry.comida.alubias',
  'Guisantes congelados': 'pantry.comida.guisantes_congelados',
  'Helado': 'pantry.comida.helado',
  'Agua': 'pantry.comida.agua',
  'Zumo': 'pantry.comida.zumo',
  'Cerveza': 'pantry.comida.cerveza',
  'Vino tinto': 'pantry.comida.vino_tinto',
};

/**
 * Los utensilios que la app siembra en la casa nueva (54).
 *
 * La clave es el nombre en castellano que guarda `server/src/utils/seed-data.ts` —lo que hay en la base de datos
 * NO se traduce nunca, porque viaja al prompt de la IA y lo reescribe la propia app al releer la lista— y el
 * valor es la etiqueta que se pinta. Lo que no esta aqui es un nombre que escribio la persona: se pinta tal cual, porque es su texto.
 */
export const UTENSIL_LABEL_KEYS: Record<string, TranslationKey> = {
  'Sartén': 'pantry.utensilio.sarten',
  'Sartén antiadherente': 'pantry.utensilio.sarten_antiadherente',
  'Sartén pequeña': 'pantry.utensilio.sarten_pequena',
  'Olla': 'pantry.utensilio.olla',
  'Olla a presión': 'pantry.utensilio.olla_a_presion',
  'Cazuela': 'pantry.utensilio.cazuela',
  'Cacerola': 'pantry.utensilio.cacerola',
  'Batería de cocina': 'pantry.utensilio.bateria_de_cocina',
  'Freidora de aire (Airfryer)': 'pantry.utensilio.freidora_de_aire_airfryer',
  'Microondas': 'pantry.utensilio.microondas',
  'Horno': 'pantry.utensilio.horno',
  'Vitrocerámica / Placa inducción': 'pantry.utensilio.vitroceramica_placa_induccion',
  'Batidora de mano': 'pantry.utensilio.batidora_de_mano',
  'Batidora de vaso / Blender': 'pantry.utensilio.batidora_de_vaso_blender',
  'Procesador de alimentos': 'pantry.utensilio.procesador_de_alimentos',
  'Tostadora': 'pantry.utensilio.tostadora',
  'Cafetera': 'pantry.utensilio.cafetera',
  'Hervidor de agua': 'pantry.utensilio.hervidor_de_agua',
  'Exprimidor': 'pantry.utensilio.exprimidor',
  'Robot de cocina': 'pantry.utensilio.robot_de_cocina',
  'Lavavajillas': 'pantry.utensilio.lavavajillas',
  'Frigorífico': 'pantry.utensilio.frigorifico',
  'Congelador': 'pantry.utensilio.congelador',
  'Tabla de cortar': 'pantry.utensilio.tabla_de_cortar',
  'Cuchillo de chef': 'pantry.utensilio.cuchillo_de_chef',
  'Cuchillo de pelar': 'pantry.utensilio.cuchillo_de_pelar',
  'Cuchillo de sierra (pan)': 'pantry.utensilio.cuchillo_de_sierra_pan',
  'Pelador': 'pantry.utensilio.pelador',
  'Rallador': 'pantry.utensilio.rallador',
  'Tijeras de cocina': 'pantry.utensilio.tijeras_de_cocina',
  'Abrelatas': 'pantry.utensilio.abrelatas',
  'Descorchador': 'pantry.utensilio.descorchador',
  'Rodillo de cocina': 'pantry.utensilio.rodillo_de_cocina',
  'Colador': 'pantry.utensilio.colador',
  'Escurridor': 'pantry.utensilio.escurridor',
  'Bol / Cuenco': 'pantry.utensilio.bol_cuenco',
  'Báscula de cocina': 'pantry.utensilio.bascula_de_cocina',
  'Vaso medidor': 'pantry.utensilio.vaso_medidor',
  'Cucharas medidoras': 'pantry.utensilio.cucharas_medidoras',
  'Espátula de silicona': 'pantry.utensilio.espatula_de_silicona',
  'Cuchara de madera': 'pantry.utensilio.cuchara_de_madera',
  'Pinzas de cocina': 'pantry.utensilio.pinzas_de_cocina',
  'Batidor de varillas': 'pantry.utensilio.batidor_de_varillas',
  'Bandeja de horno': 'pantry.utensilio.bandeja_de_horno',
  'Molde para bizcocho': 'pantry.utensilio.molde_para_bizcocho',
  'Fuente de cristal': 'pantry.utensilio.fuente_de_cristal',
  'Papel de horno': 'pantry.utensilio.papel_de_horno',
  'Paños de cocina': 'pantry.utensilio.panos_de_cocina',
  'Papel de cocina': 'pantry.utensilio.papel_de_cocina',
  'Delantal': 'pantry.utensilio.delantal',
  'Guantes de horno': 'pantry.utensilio.guantes_de_horno',
  'Tupperware / Recipientes': 'pantry.utensilio.tupperware_recipientes',
  'Papel film': 'pantry.utensilio.papel_film',
  'Papel de aluminio': 'pantry.utensilio.papel_de_aluminio',
};

/**
 * La etiqueta de un nombre del catalogo, en el idioma activo; `null` si la palabra no es del catalogo.
 *
 * Se mira primero la despensa y luego los utensilios: los dos conjuntos son disjuntos —lo comprueba el spec
 * espejo `server/src/utils/pantry-catalog-i18n.spec.ts`—, y asi la pantalla no tiene que decir de que catalogo es
 * cada nombre, que es exactamente el tipo de parametro que se pasa cruzado.
 */
export function catalogLabelKey(value: string | null | undefined): TranslationKey | null {
  if (!value) return null;
  return FOOD_LABEL_KEYS[value] ?? UTENSIL_LABEL_KEYS[value] ?? null;
}

/** Los dos catalogos juntos, para quien solo necesita saber si una palabra es del semillero (y pruebas). */
export const CATALOG_LABEL_KEYS: Record<string, TranslationKey> = { ...FOOD_LABEL_KEYS, ...UTENSIL_LABEL_KEYS };

/**
 * Las doce categorias con las que nace una casa (HOGARIA-SPEC ## 12x) y el nombre en castellano con el que el
 * server las siembra. Los dos mapas van juntos y el `spec` del puente falla si se separan de
 * `server/src/utils/pantry-categories.ts`, que es quien los escribe.
 *
 * Para que sirve el segundo: si alguien renombra «Verduras» a «Verduras de la huerta», **la etiqueta pasa a ser
 * su texto**, no la frase del diccionario —lo que hay en la base de datos gana, siempre—. Por eso la decision
 * no es «la clave es de fabrica», sino «la clave es de fabrica y el nombre sigue siendo el de fabrica».
 */
export const PANTRY_CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  // El padre de fabrica de la ## 12aa: una casa que lo tiene, lo lee en su idioma; y el catalogo del super lo
  // crea delante de sus hojas cuando añade algo de un pasillo que la casa aun no tiene.
  alimentos: 'pantry.categoria_alimentos',
  vegetables: 'pantry.categoria_verduras',
  fruits: 'pantry.categoria_frutas',
  meat: 'pantry.categoria_carnes',
  fish: 'pantry.categoria_pescados',
  dairy: 'pantry.categoria_lacteos',
  grains: 'pantry.categoria_cereales',
  spices: 'pantry.categoria_especias',
  condiments: 'pantry.categoria_condimentos',
  frozen: 'pantry.categoria_congelados',
  canned: 'pantry.categoria_enlatados',
  beverages: 'pantry.categoria_bebidas',
  other: 'pantry.categoria_otros'
};

export const PANTRY_CATEGORY_FACTORY_NAMES: Record<string, string> = {
  alimentos: 'Alimentos',
  vegetables: 'Verduras',
  fruits: 'Frutas',
  meat: 'Carnes',
  fish: 'Pescados',
  dairy: 'Lácteos',
  grains: 'Cereales',
  spices: 'Especias',
  condiments: 'Condimentos',
  frozen: 'Congelados',
  canned: 'Enlatados',
  beverages: 'Bebidas',
  other: 'Otros'
};

/**
 * La etiqueta de una categoria del inventario, en el idioma activo. `key` y `name` pueden venir sueltos (una
 * fila de la despensa solo trae la clave) o juntos (una fila del catalogo).
 */
export function pantryCategoryLabel(
  categoria: { key?: string | null; name?: string | null } | string | null | undefined,
  t: (key: TranslationKey) => string
): string {
  const fila = typeof categoria === 'string' ? { key: categoria } : categoria ?? {};
  const clave = fila.key ?? '';
  const etiquetaDeFabrica = PANTRY_CATEGORY_LABEL_KEYS[clave];
  const sigueSiendoDeFabrica = !fila.name || fila.name === PANTRY_CATEGORY_FACTORY_NAMES[clave];
  if (etiquetaDeFabrica && sigueSiendoDeFabrica) return t(etiquetaDeFabrica);
  return fila.name ?? clave ?? '';
}
