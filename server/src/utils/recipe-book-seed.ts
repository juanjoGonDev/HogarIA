import type Database from 'better-sqlite3';

type MealType = 'breakfast' | 'brunch' | 'lunch' | 'snack' | 'dinner' | 'dessert';
type Unit = 'g' | 'kg' | 'ml' | 'l' | 'cup' | 'tbsp' | 'tsp' | 'unit' | 'bunch' | 'slice' | 'piece';
type RecipeIngredient = {
  name: string;
  quantity: number;
  unit: Unit;
  preparation?: string;
  isOptional?: boolean;
  substitutes?: string[];
  notes?: string;
};
type RecipeStep = {
  stepNumber: number;
  instruction: string;
  timerRequired?: boolean;
  timerDuration?: number;
  duration?: number;
  tips?: string;
  warning?: string;
};
type SourceAttribution = {
  publisher: string;
  title: string;
  url: string;
  note: string;
};
type RecipeGuidance = {
  appliances: string[];
  parallelTasks: string[];
  tipsAndVariations: string[];
};
type RecipeNutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
};
type RecipeStorage = {
  method: string;
  container: string;
  duration: string;
  reheatingInstructions: string;
  freezingPossible: boolean;
  freezingDuration: string | null;
};
type RecipeBookSeed = {
  id: string;
  catalogKey: string;
  countryCode: 'ES' | 'SV';
  name: string;
  description: string;
  cuisine: string;
  mealType: MealType[];
  difficulty: 'easy' | 'medium' | 'hard';
  totalTime: number;
  prepTime: number;
  cookTime: number;
  restTime: number;
  servings: number;
  calories: number;
  ingredients: RecipeIngredient[];
  utensils: string[];
  instructionsByLevel: Record<'basic' | 'intermediate' | 'expert', RecipeStep[]>;
  washInstruction: string;
  prepInstruction: string;
  finishInstruction: string;
  guidance: RecipeGuidance;
  nutrition: RecipeNutrition;
  storage: RecipeStorage;
  tags: string[];
  sourceAttribution: SourceAttribution;
};

const spainSource: SourceAttribution = {
  publisher: 'TURESPAÑA — Spain.info',
  title: 'Platos de la gastronomía española tradicional',
  url: 'https://www.spain.info/es/descubrir-espana/platos-gastronomia-tradicional-espana/',
  note: 'Fuente consultada para verificar que el plato pertenece a la tradición culinaria española. Texto e instrucciones de esta ficha redactados para HogarIA.'
};
const paellaSource: SourceAttribution = {
  publisher: 'TURESPAÑA — Spain.info',
  title: 'Conoce el origen de los platos españoles más típicos',
  url: 'https://www.spain.info/es/top/conoce-el-origen-de-algunos-platos-espanoles-tipicos/',
  note: 'Fuente consultada para verificar el origen valenciano y los ingredientes tradicionales de referencia. Texto e instrucciones de esta ficha redactados para HogarIA.'
};
const salvadorSource: SourceAttribution = {
  publisher: 'El Salvador Travel — Ministerio de Turismo',
  title: 'Gastronomía salvadoreña',
  url: 'https://elsalvador.travel/preforocimap/gastronomia-salvadorena/',
  note: 'Fuente consultada para verificar la presencia del plato y sus rasgos tradicionales. Texto e instrucciones de esta ficha redactados para HogarIA.'
};
const maizeSource: SourceAttribution = {
  publisher: 'Ministerio de Educación de El Salvador',
  title: 'Libro de Estudios Sociales (4.º grado)',
  url: 'https://www.mined.gob.sv/descarga/programas-estudio/libro_4_sociales_0_.pdf',
  note: 'Material educativo del Ministerio consultado para verificar la costumbre de preparar riguas durante la cosecha del maíz. La receta y sus instrucciones están redactadas para HogarIA.'
};

const step = (instruction: string, duration?: number, tips?: string): RecipeStep => ({
  stepNumber: 1,
  instruction,
  timerRequired: duration !== undefined,
  ...(duration === undefined ? {} : { duration, timerDuration: duration }),
  ...(tips ? { tips } : {})
});

/** Texto culinario original; las fuentes atribuyen únicamente la tradición/origen, no la receta. */
export const RECIPE_BOOK_SEEDS: readonly RecipeBookSeed[] = [
  {
    id: 'recipe-catalog-es-tortilla-patatas',
    catalogKey: 'es-tortilla-patatas-v1',
    countryCode: 'ES',
    name: 'Tortilla de patatas',
    description: 'Tortilla jugosa de patata y huevo, clásica en tapas y comidas caseras.',
    cuisine: 'española',
    mealType: ['breakfast', 'snack', 'dinner'],
    difficulty: 'medium',
    totalTime: 45,
    prepTime: 15,
    cookTime: 30,
    servings: 4,
    ingredients: [
      { name: 'Patata', quantity: 600, unit: 'g', preparation: 'pelada y en láminas finas' },
      { name: 'Huevo', quantity: 6, unit: 'unit' },
      {
        name: 'Cebolla',
        quantity: 1,
        unit: 'unit',
        isOptional: true,
        substitutes: ['cebolleta', 'puerro']
      },
      { name: 'Aceite de oliva', quantity: 250, unit: 'ml' },
      { name: 'Sal', quantity: 5, unit: 'g' }
    ],
    utensils: ['Sartén antiadherente', 'Bol', 'Plato llano'],
    instructionsByLevel: {
      basic: [
        step(
          'Pela las patatas y córtalas en láminas finas, de grosor parecido, para que se ablanden a la vez. Si vas a usar cebolla, pélala y córtala en tiras finas.'
        ),
        step(
          'Calienta el aceite en una sartén a fuego medio-bajo y añade las patatas y la cebolla con cuidado. Muévelas de vez en cuando: deben quedar blandas y ligeramente transparentes, no tostadas.',
          25
        ),
        step(
          'Pasa las patatas y la cebolla a un colador colocado sobre un bol. Espera a que escurra el aceite y reserva una cucharada para la sartén.'
        ),
        step(
          'Casca los huevos en otro bol, añade la sal y bátelos hasta que yema y clara queden mezcladas. Incorpora las patatas y la cebolla con una cuchara y deja reposar cinco minutos.'
        ),
        step(
          'Calienta la sartén con el aceite reservado a fuego medio-bajo. Vierte la mezcla y cocina hasta que el borde se vea cuajado y la parte superior aún esté algo húmeda.'
        ),
        step(
          'Despega el borde con una espátula. Cubre la sartén con un plato grande, sujétalo con firmeza y dale la vuelta lejos del fuego; desliza la tortilla de nuevo y termina de cuajarla al punto que prefieras.',
          6
        )
      ],
      intermediate: [
        step(
          'Corta la patata en láminas regulares y, si la usas, la cebolla en pluma. Confítalas sin dorar, escúrrelas y mézclalas con huevo y sal; deja reposar cinco minutos.',
          25
        ),
        step(
          'Cuaja en una sartén caliente engrasada, voltea con un plato cuando el borde esté firme y termina al punto de jugosidad que prefieras.',
          6
        )
      ],
      expert: [
        step(
          'Confita la patata a 120–130 °C sin dorarla; escurre, sala e incorpora al huevo. Ajusta el reposo según su humedad.',
          25
        ),
        step(
          'Cuaja en sartén precalentada, remueve brevemente el centro y voltea cuando el borde esté firme; retira al punto elegido.',
          6,
          'El huevo poco cuajado requiere huevos frescos y conservación refrigerada.'
        )
      ]
    },
    tags: ['tradicional', 'tapa', 'huevo'],
    restTime: 0,
    calories: 450,
    washInstruction:
      'Lava las patatas y, si la usas, la cebolla antes de pelarlas; sécalas. No laves los huevos.',
    prepInstruction:
      'Prepara una tabla estable, pela y corta la patata en láminas parejas, y deja el bol, la sartén y el plato para voltear a mano.',
    finishInstruction:
      'Comprueba que el centro haya cuajado al punto que prefieres, deja reposar un par de minutos y sirve en porciones. Refrigera enseguida las sobras.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras la patata se ablanda, bate los huevos y prepara el plato con el que voltearás la tortilla.'
      ],
      tipsAndVariations: [
        'Para una tortilla más jugosa, retírala cuando el centro aún ceda ligeramente; usa huevos bien conservados y cuájala más si la comerán personas vulnerables.',
        'Escurre bien la patata antes de mezclarla con el huevo; añade cebollino o una pizca de pimienta si te gusta.'
      ]
    },
    nutrition: { calories: 450, protein: 20, carbs: 32, fat: 27, fiber: 3, sugar: 4, sodium: 650 },
    storage: {
      method:
        'Enfría en un recipiente poco profundo y refrigera antes de 2 horas; mantenla a 5 °C o menos.',
      container: 'Recipiente hermético, en una sola capa si es posible',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions:
        'Calienta solo la porción que vayas a comer hasta que esté muy caliente en el centro.',
      freezingPossible: false,
      freezingDuration: null
    },
    sourceAttribution: spainSource
  },
  {
    id: 'recipe-catalog-es-gazpacho-andaluz',
    catalogKey: 'es-gazpacho-andaluz-v1',
    countryCode: 'ES',
    name: 'Gazpacho andaluz',
    description: 'Sopa fría de tomate y hortalizas, refrescante y sencilla.',
    cuisine: 'andaluza',
    mealType: ['lunch', 'snack'],
    difficulty: 'easy',
    totalTime: 80,
    prepTime: 20,
    cookTime: 0,
    servings: 4,
    ingredients: [
      { name: 'Tomate maduro', quantity: 800, unit: 'g' },
      { name: 'Pepino', quantity: 120, unit: 'g' },
      { name: 'Pimiento verde', quantity: 80, unit: 'g' },
      { name: 'Ajo', quantity: 1, unit: 'unit' },
      { name: 'Aceite de oliva', quantity: 60, unit: 'ml' },
      { name: 'Vinagre de vino', quantity: 20, unit: 'ml' },
      {
        name: 'Pan',
        quantity: 40,
        unit: 'g',
        isOptional: true,
        substitutes: ['miga de pan sin gluten']
      },
      { name: 'Agua fría', quantity: 150, unit: 'ml' },
      { name: 'Sal', quantity: 5, unit: 'g' }
    ],
    utensils: ['Batidora', 'Jarra', 'Colador'],
    instructionsByLevel: {
      basic: [
        step(
          'Corta los tomates y el pepino en trozos que quepan en la batidora. Retira el tallo y las semillas del pimiento; pela el ajo.'
        ),
        step(
          'Pon en la batidora las hortalizas, el ajo, el vinagre, la sal y el pan si quieres que quede más espeso. Cierra bien la tapa y tritura hasta que no veas trozos.'
        ),
        step(
          'Con la batidora en marcha, vierte el aceite poco a poco para que se mezcle y quede una textura uniforme.'
        ),
        step(
          'Añade el agua fría poco a poco, prueba con una cuchara y detente cuando la sopa tenga la densidad que te guste. Si aún notas pieles, pásala por un colador.'
        ),
        step(
          'Tapa la jarra y deja el gazpacho en el frigorífico al menos una hora. Sírvelo frío y prueba de nuevo la sal y el vinagre antes de llevarlo a la mesa.',
          60
        )
      ],
      intermediate: [
        step(
          'Retira el pedúnculo de los tomates y las semillas del pimiento. Tritura con pepino, ajo, pan opcional, vinagre y sal hasta que no queden trozos.',
          5
        ),
        step(
          'Añade el aceite poco a poco mientras bates y ajusta la textura con agua fría. Refrigera para que se integren los sabores.',
          10
        )
      ],
      expert: [
        step(
          'Tritura hortalizas, vinagre y sal; emulsiona con el aceite en hilo y cuela si buscas finura.',
          6
        ),
        step('Enfría tapado y rectifica acidez y densidad al servir; no añadas hielo.', 10)
      ]
    },
    tags: ['tradicional', 'frío', 'vegetariano'],
    restTime: 60,
    calories: 190,
    washInstruction:
      'Lava y seca los tomates, el pepino y el pimiento antes de trocearlos; retira las partes dañadas. Pela el ajo.',
    prepInstruction:
      'Retira pedúnculos y semillas cuando convenga, corta las hortalizas en trozos que quepan en la batidora y ten lista una jarra limpia.',
    finishInstruction:
      'Prueba y ajusta sal, vinagre y agua fría; tapa y enfría al menos una hora para servirlo bien frío, sin hielo que lo diluya.',
    guidance: {
      appliances: ['Batidora', 'Frigorífico'],
      parallelTasks: [
        'Mientras trituras por tandas, enfría los cuencos de servicio y prepara guarnición de pepino o picatostes.'
      ],
      tipsAndVariations: [
        'Añade el aceite al final en hilo para una textura más ligada y pásalo por colador si lo prefieres fino.',
        'El pan es opcional: omítelo para un resultado más ligero y ajusta la densidad con agua fría poco a poco.'
      ]
    },
    nutrition: { calories: 190, protein: 4, carbs: 18, fat: 12, fiber: 5, sugar: 12, sodium: 550 },
    storage: {
      method:
        'Tapa y refrigera enseguida a 5 °C o menos; no lo dejes más de 2 horas a temperatura ambiente.',
      container: 'Botella o recipiente hermético de vidrio',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions: 'No se recalienta; remueve y sírvelo frío.',
      freezingPossible: false,
      freezingDuration: null
    },
    sourceAttribution: spainSource
  },
  {
    id: 'recipe-catalog-es-paella-valenciana',
    catalogKey: 'es-paella-valenciana-v1',
    countryCode: 'ES',
    name: 'Paella valenciana',
    description: 'Arroz seco de la tradición valenciana con pollo, conejo y verduras.',
    cuisine: 'valenciana',
    mealType: ['lunch'],
    difficulty: 'hard',
    totalTime: 80,
    prepTime: 20,
    cookTime: 55,
    servings: 4,
    ingredients: [
      { name: 'Arroz', quantity: 320, unit: 'g' },
      { name: 'Pollo', quantity: 300, unit: 'g', preparation: 'en trozos' },
      { name: 'Conejo', quantity: 250, unit: 'g', preparation: 'en trozos' },
      { name: 'Judía verde plana', quantity: 150, unit: 'g' },
      { name: 'Garrofón', quantity: 100, unit: 'g', substitutes: ['alubia blanca cocida'] },
      { name: 'Tomate triturado', quantity: 120, unit: 'g' },
      { name: 'Aceite de oliva', quantity: 45, unit: 'ml' },
      { name: 'Azafrán', quantity: 1, unit: 'g' },
      { name: 'Agua', quantity: 1.1, unit: 'l' },
      { name: 'Pimentón dulce', quantity: 4, unit: 'g' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Paella', 'Cuchara de madera'],
    instructionsByLevel: {
      basic: [
        step(
          'Calienta el aceite en la paella a fuego medio. Coloca el pollo y el conejo separados, añade parte de la sal y dóralos por todos sus lados; usa utensilios limpios después de tocar la carne cruda.',
          10
        ),
        step(
          'Aparta la carne hacia los bordes. Añade las judías al centro y remuévelas unos minutos; agrega el tomate y cocina hasta que pierda parte de su líquido.'
        ),
        step(
          'Añade el pimentón y remueve solo unos segundos para que no se queme. Vierte el agua con cuidado, incorpora la carne y deja que hierva suavemente hasta que esté tierna.',
          20
        ),
        step(
          'Agrega el garrofón y el azafrán. Reparte el arroz por la paella en una capa uniforme y no lo remuevas después de distribuirlo.'
        ),
        step(
          'Cocina a fuego vivo durante los primeros minutos y luego bájalo para mantener un hervor constante. Está listo cuando el arroz esté tierno y ya no quede caldo suelto; vigila el fuego todo el tiempo.',
          18
        ),
        step(
          'Apaga el fuego, cubre la paella con un paño limpio y deja reposar cinco minutos antes de servir.',
          5
        )
      ],
      intermediate: [
        step(
          'Calienta la paella, dora por igual pollo y conejo y reserva el espacio central para sofreír las judías y el tomate. Añade pimentón y agua antes de que se queme.',
          12
        ),
        step(
          'Hierve el caldo con la carne, incorpora garrofón, azafrán y arroz distribuido en cruz. Cocina a fuego vivo al inicio y moderado después; deja reposar tapado fuera del fuego.',
          35
        )
      ],
      expert: [
        step(
          'Dora la carne y concentra judías y tomate; incorpora el pimentón sin quemarlo. Ajusta el caldo a la paella y estabiliza el hervor.',
          12
        ),
        step(
          'Añade garrofón, azafrán y arroz en una sola capa. No remuevas; controla el fuego hasta la absorción y busca socarrat sin humo. Reposa tapado.',
          30,
          'Mantén la paella estable y supervisa el fuego continuamente.'
        )
      ]
    },
    tags: ['tradicional', 'arroz', 'valencia'],
    restTime: 5,
    calories: 650,
    washInstruction:
      'Lava y seca las judías y el tomate. No enjuagues el pollo ni el conejo crudos: sécalos con papel y evita que sus utensilios toquen otros alimentos.',
    prepInstruction:
      'Mide arroz, agua y especias antes de encender el fuego; prepara una paellera ancha y mantén separadas las tablas usadas para la carne cruda.',
    finishInstruction:
      'Cuando el arroz esté tierno y el caldo se haya absorbido, apaga el fuego y deja reposar cinco minutos. Sirve con utensilios limpios.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras hierve el caldo, pesa el arroz y prepara las hebras de azafrán; no apartes la atención de la paellera.'
      ],
      tipsAndVariations: [
        'Distribuye el arroz en una capa fina y evita removerlo una vez añadido para favorecer una cocción uniforme.',
        'Si el caldo se consume antes de que el grano esté tierno, añade un poco de agua caliente; deja reposar antes de servir.'
      ]
    },
    nutrition: { calories: 650, protein: 32, carbs: 80, fat: 21, fiber: 6, sugar: 6, sodium: 900 },
    storage: {
      method: 'Reparte pronto en recipientes bajos y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipiente hermético poco profundo; separa porciones para enfriar rápido',
      duration: '1 día como orientación conservadora',
      reheatingInstructions:
        'Añade una cucharada de agua y calienta una sola vez hasta que humee también en el centro.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para conservar mejor la textura'
    },
    sourceAttribution: paellaSource
  },
  {
    id: 'recipe-catalog-es-cocido-madrileno',
    catalogKey: 'es-cocido-madrileno-v1',
    countryCode: 'ES',
    name: 'Cocido madrileño',
    description: 'Guiso de garbanzos, verduras y carnes servido en vuelcos.',
    cuisine: 'madrileña',
    mealType: ['lunch', 'dinner'],
    difficulty: 'medium',
    totalTime: 180,
    prepTime: 20,
    cookTime: 160,
    servings: 4,
    ingredients: [
      { name: 'Garbanzos secos', quantity: 300, unit: 'g', preparation: 'remojados la víspera' },
      { name: 'Morcillo', quantity: 300, unit: 'g' },
      { name: 'Pollo', quantity: 250, unit: 'g' },
      { name: 'Chorizo', quantity: 150, unit: 'g', substitutes: ['chorizo de pavo'] },
      { name: 'Patata', quantity: 300, unit: 'g' },
      { name: 'Zanahoria', quantity: 150, unit: 'g' },
      { name: 'Repollo', quantity: 250, unit: 'g' },
      { name: 'Fideo', quantity: 80, unit: 'g' },
      { name: 'Agua', quantity: 2, unit: 'l' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Olla grande', 'Cazo', 'Colador'],
    instructionsByLevel: {
      basic: [
        step(
          'Enjuaga los garbanzos que dejaste en remojo y escúrrelos. Ponlos en una olla con las carnes y agua fría suficiente para cubrirlas; no llenes la olla hasta el borde.'
        ),
        step(
          'Calienta hasta que empiece a hervir. Retira con una cuchara la espuma que suba, baja el fuego y deja un hervor suave; añade agua caliente si los garbanzos dejan de estar cubiertos.',
          120
        ),
        step(
          'Cuando los garbanzos estén casi tiernos, añade el chorizo. Comprueba el punto pinchando uno: debe aplastarse con facilidad, pero conservar su forma.'
        ),
        step(
          'Añade la patata y la zanahoria en trozos grandes y cocina hasta que un cuchillo entre sin resistencia. Cuece el repollo aparte en agua hasta que esté blando y escúrrelo.'
        ),
        step(
          'Cuela parte del caldo en un cazo, añade los fideos y cuécelos el tiempo indicado en el paquete. Sirve primero la sopa y después los garbanzos, las carnes y las verduras.',
          6
        )
      ],
      intermediate: [
        step(
          'Pon garbanzos remojados, morcillo y pollo en agua fría. Desespuma al hervir y cocina a fuego lento; incorpora chorizo después para moderar la grasa.',
          120
        ),
        step(
          'Añade patata y zanahoria hasta que estén hechas; cuece el repollo separado. Cuela parte del caldo, cocina los fideos y organiza el servicio en sopa, garbanzos y carnes.',
          35
        )
      ],
      expert: [
        step(
          'Mantén un hervor mínimo y espuma para un caldo limpio; retira cada carne cuando alcance su punto.',
          120
        ),
        step(
          'Cuece las hortalizas sin deshacerlas, desgrasa el caldo y cocina los fideos al servir. Presenta los vuelcos separados.',
          35
        )
      ]
    },
    tags: ['tradicional', 'cuchara', 'garbanzos'],
    restTime: 0,
    calories: 720,
    washInstruction:
      'Enjuaga los garbanzos ya remojados y lava las verduras. No laves el morcillo ni el pollo crudos; usa tabla y manos limpias tras manipularlos.',
    prepInstruction:
      'Prepara una olla grande, un cazo para el repollo y un colador; corta patata y zanahoria en piezas de tamaño parecido.',
    finishInstruction:
      'Comprueba que los garbanzos estén tiernos y las carnes bien cocinadas. Sirve primero la sopa y después los vuelcos; separa las sobras enseguida.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras el caldo hierve suavemente, lava y corta las verduras con utensilios distintos de los usados para la carne cruda.'
      ],
      tipsAndVariations: [
        'Mantén un hervor suave y añade agua caliente si hace falta para que los garbanzos sigan cubiertos.',
        'Sirve los vuelcos por separado y desgrasa el caldo en superficie si quieres un resultado menos graso.'
      ]
    },
    nutrition: { calories: 720, protein: 45, carbs: 57, fat: 29, fiber: 12, sugar: 9, sodium: 900 },
    storage: {
      method:
        'Enfría el caldo y los sólidos por separado y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipientes herméticos poco profundos, por componentes',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions:
        'Recalienta una sola vez hasta que hierva suavemente y esté muy caliente en el centro.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura; congela la sopa sin fideos si puedes'
    },
    sourceAttribution: spainSource
  },
  {
    id: 'recipe-catalog-es-pulpo-feira',
    catalogKey: 'es-pulpo-feira-v1',
    countryCode: 'ES',
    name: 'Pulpo a feira',
    description: 'Pulpo cocido con patata, aceite de oliva y pimentón.',
    cuisine: 'gallega',
    mealType: ['lunch', 'dinner', 'snack'],
    difficulty: 'medium',
    totalTime: 70,
    prepTime: 10,
    cookTime: 60,
    servings: 4,
    ingredients: [
      { name: 'Pulpo', quantity: 1, unit: 'kg', preparation: 'limpio y descongelado si procede' },
      { name: 'Patata', quantity: 500, unit: 'g' },
      { name: 'Aceite de oliva', quantity: 45, unit: 'ml' },
      { name: 'Pimentón dulce', quantity: 4, unit: 'g' },
      {
        name: 'Pimentón picante',
        quantity: 1,
        unit: 'g',
        isOptional: true,
        substitutes: ['una pizca de cayena']
      },
      { name: 'Sal gruesa', quantity: 5, unit: 'g' }
    ],
    utensils: ['Olla grande', 'Tabla', 'Tijeras de cocina'],
    instructionsByLevel: {
      basic: [
        step(
          'Pon agua suficiente en una olla grande y espera a que hierva. Sujeta el pulpo con unas pinzas, bájalo al agua unos segundos y sácalo; repite tres veces para que los tentáculos se ricen.'
        ),
        step(
          'Deja el pulpo dentro, baja el fuego para que el agua hierva suavemente y tapa parcialmente la olla. Está tierno cuando una brocheta entra con poca resistencia en la parte gruesa del tentáculo.',
          45
        ),
        step(
          'Saca el pulpo con las pinzas y cuece las patatas en esa misma agua. Comprueba el centro con un cuchillo; si aún está duro, deja que hiervan unos minutos más.',
          15
        ),
        step(
          'Escurre las patatas y córtalas en rodajas cuando puedas manipularlas. Corta el pulpo con tijeras en trozos de un bocado, con cuidado porque conserva calor.'
        ),
        step(
          'Coloca primero las patatas y luego el pulpo en una fuente. Añade aceite de oliva, pimentón y sal justo antes de servir.'
        )
      ],
      intermediate: [
        step(
          'Lleva agua a ebullición y sumerge el pulpo tres veces para rizar los tentáculos; déjalo cocer suavemente hasta que una brocheta entre con facilidad.',
          45
        ),
        step(
          'Cuece las patatas en el caldo, escúrrelas y córtalas en rodajas. Trocea el pulpo con tijeras y sazona al servir.',
          15
        )
      ],
      expert: [
        step(
          'Cuece a hervor moderado hasta que la brocheta entre con poca resistencia en la parte gruesa del tentáculo.',
          45,
          'Usa una olla amplia y evita salpicaduras al introducir el pulpo.'
        ),
        step(
          'Templa las patatas, cubre con pulpo recién cortado y termina con sal gruesa, pimentón y aceite.',
          10
        )
      ]
    },
    tags: ['tradicional', 'galicia', 'marisco'],
    restTime: 0,
    calories: 400,
    washInstruction:
      'Lava las patatas. Si el pulpo ya viene limpio y descongelado, no hace falta lavarlo; evita enjuagar marisco crudo bajo el grifo.',
    prepInstruction:
      'Comprueba que el pulpo esté completamente descongelado si procede, prepara una olla amplia y ten a mano una brocheta para comprobar la ternura.',
    finishInstruction:
      'Corta el pulpo en rodajas con tijeras, colócalo sobre las patatas aún calientes y aliña justo antes de servir.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras cuece el pulpo, lava y prepara las patatas; usa una tabla limpia para el pulpo cocido.'
      ],
      tipsAndVariations: [
        'Mantén un hervor suave y comprueba la parte más gruesa con una brocheta; el tiempo depende del tamaño real.',
        'Añade el pimentón y el aceite al final para que el aroma se note y no se queme.'
      ]
    },
    nutrition: { calories: 400, protein: 32, carbs: 38, fat: 14, fiber: 4, sugar: 3, sodium: 800 },
    storage: {
      method: 'Guarda pulpo y patata pronto en frío, antes de 2 horas y a 5 °C o menos.',
      container: 'Recipiente hermético poco profundo',
      duration: '1 día como orientación conservadora',
      reheatingInstructions:
        'Calienta suavemente hasta que esté muy caliente en el centro y añade el aliño al servir.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura'
    },
    sourceAttribution: spainSource
  },
  {
    id: 'recipe-catalog-es-tarta-santiago',
    catalogKey: 'es-tarta-santiago-v1',
    countryCode: 'ES',
    name: 'Tarta de Santiago',
    description: 'Tarta gallega de almendra, huevo y azúcar, sin base de masa.',
    cuisine: 'gallega',
    mealType: ['dessert'],
    difficulty: 'easy',
    totalTime: 65,
    prepTime: 15,
    cookTime: 40,
    servings: 8,
    ingredients: [
      { name: 'Almendra molida', quantity: 250, unit: 'g' },
      { name: 'Azúcar', quantity: 250, unit: 'g' },
      { name: 'Huevo', quantity: 5, unit: 'unit' },
      { name: 'Ralladura de limón', quantity: 1, unit: 'tsp' },
      { name: 'Canela', quantity: 2, unit: 'g' },
      { name: 'Azúcar glas', quantity: 10, unit: 'g', isOptional: true }
    ],
    utensils: ['Molde redondo', 'Bol', 'Batidor', 'Horno'],
    instructionsByLevel: {
      basic: [
        step(
          'Enciende el horno a 180 °C para que se caliente mientras preparas la mezcla. Coloca papel de horno en la base del molde y engrasa ligeramente los lados.'
        ),
        step(
          'Casca los huevos en un bol, añade el azúcar y bátelos hasta que la mezcla tenga un color uniforme. No hace falta que quede muy espumosa.'
        ),
        step(
          'Añade la almendra molida, la ralladura fina de limón y la canela. Mezcla despacio hasta que no queden zonas secas en la masa.'
        ),
        step(
          'Vierte la masa en el molde y alisa la superficie con una cuchara. Coloca el molde en el centro del horno y cierra la puerta.',
          35
        ),
        step(
          'Comprueba el centro con un palillo: debe salir limpio o con unas migas, no cubierto de masa líquida. Si sale húmedo, hornea cinco minutos más y vuelve a comprobar.'
        ),
        step(
          'Saca el molde con guantes de horno y deja enfriar por completo sobre una superficie resistente al calor. Desmolda cuando esté fría y espolvorea el azúcar glas.'
        )
      ],
      intermediate: [
        step(
          'Calienta el horno a 180 °C y mezcla huevos y azúcar sin montar en exceso. Incorpora almendra molida, ralladura fina y canela hasta obtener una masa homogénea.',
          10
        ),
        step(
          'Hornea en molde engrasado hasta que la superficie dore y un palillo salga casi limpio. Deja enfriar por completo antes de espolvorear azúcar glas.',
          35
        )
      ],
      expert: [
        step('Mezcla lo justo para una miga compacta y húmeda; nivela la masa en el molde.', 10),
        step(
          'Hornea a 180 °C hasta que el centro esté firme. Enfría en rejilla y termina con azúcar glas.',
          35
        )
      ]
    },
    tags: ['tradicional', 'postre', 'almendra'],
    restTime: 10,
    calories: 520,
    washInstruction:
      'Lava y seca el limón antes de rallar solo la parte amarilla. No laves los huevos; comprueba que estén limpios y en buen estado.',
    prepInstruction:
      'Precalienta la freidora de aire/mini horno a 180 °C, prepara el molde con papel o una capa fina de grasa y pesa todos los ingredientes.',
    finishInstruction:
      'Deja que la tarta se enfríe antes de desmoldarla; cuando esté fría, añade azúcar glas opcional y corta con un cuchillo limpio.',
    guidance: {
      appliances: ['Freidora de aire / mini horno (máximo 200 °C)'],
      parallelTasks: [
        'Mientras se calienta el horno, pesa la almendra y prepara el molde; no dejes el horno encendido sin vigilancia.'
      ],
      tipsAndVariations: [
        'No batas en exceso los huevos para evitar incorporar demasiado aire; la tarta debe quedar compacta y húmeda.',
        'Comprueba el centro con un palillo: unas migas húmedas son preferibles a hornear hasta resecar.'
      ]
    },
    nutrition: { calories: 520, protein: 13, carbs: 50, fat: 30, fiber: 4, sugar: 37, sodium: 150 },
    storage: {
      method: 'Cuando pierda el calor fuerte, tapa y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Caja hermética para tarta',
      duration: '2 días como orientación conservadora',
      reheatingInstructions:
        'No hace falta recalentar; deja una porción unos minutos fuera del frío antes de servir.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura; descongela en el frigorífico'
    },
    sourceAttribution: spainSource
  },
  {
    id: 'recipe-catalog-sv-pupusa-revuelta',
    catalogKey: 'sv-pupusa-revuelta-v1',
    countryCode: 'SV',
    name: 'Pupusa revuelta con curtido',
    description:
      'Tortilla de masa de maíz rellena de queso, frijol y chicharrón, servida con curtido.',
    cuisine: 'salvadoreña',
    mealType: ['breakfast', 'dinner'],
    difficulty: 'medium',
    totalTime: 55,
    prepTime: 35,
    cookTime: 20,
    servings: 4,
    ingredients: [
      { name: 'Masa de maíz', quantity: 500, unit: 'g' },
      { name: 'Quesillo', quantity: 180, unit: 'g', substitutes: ['mozzarella de baja humedad'] },
      { name: 'Frijol refrito', quantity: 150, unit: 'g' },
      { name: 'Chicharrón molido', quantity: 120, unit: 'g' },
      { name: 'Agua', quantity: 250, unit: 'ml' },
      { name: 'Repollo', quantity: 250, unit: 'g', preparation: 'finamente cortado' },
      { name: 'Zanahoria', quantity: 80, unit: 'g', preparation: 'rallada' },
      { name: 'Vinagre', quantity: 100, unit: 'ml' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Comal o sartén pesada', 'Bol', 'Espátula'],
    instructionsByLevel: {
      basic: [
        step(
          'Pon el repollo y la zanahoria en un bol limpio. Añade el vinagre y parte de la sal, mezcla con una cuchara y deja reposar el curtido mientras preparas las pupusas.'
        ),
        step(
          'En otro bol, mezcla el quesillo, el frijol refrito y el chicharrón molido. No llenes demasiado las pupusas; reserva el relleno que no quepa.'
        ),
        step(
          'Pon la masa en un bol y agrega el agua poco a poco mientras amasas. Detente cuando puedas formar una bola suave que no se agriete al apretarla.'
        ),
        step(
          'Divide la masa en porciones iguales. Humedécete las manos, aplana una porción en la palma y deja el centro un poco más grueso que los bordes.'
        ),
        step(
          'Coloca una cucharada de relleno en el centro, junta los bordes para cerrarla y aplástala despacio hasta formar un disco. Si aparece una grieta, ciérrala con los dedos húmedos.'
        ),
        step(
          'Cocina los discos en un comal caliente a fuego medio. Dales la vuelta cuando la base tenga manchas doradas y cocina el otro lado hasta que el relleno esté caliente; sirve con el curtido escurrido.',
          18
        )
      ],
      intermediate: [
        step(
          'Prepara el curtido y déjalo reposar. Combina el relleno sin excederte para que se pueda cerrar; divide la masa en bolas y mantén las manos húmedas.',
          10
        ),
        step(
          'Abre cada bola en la palma, coloca el relleno en el centro, sella y vuelve a formar un disco parejo. Cocina en comal caliente hasta que aparezcan manchas doradas por ambos lados.',
          18
        )
      ],
      expert: [
        step(
          'Hidrata la masa hasta que no se agriete. Dosifica poco relleno, expulsa el aire y sella el borde.',
          15
        ),
        step('Dora a calor medio por ambos lados; sirve caliente con curtido escurrido.', 12)
      ]
    },
    tags: ['tradicional', 'maíz', 'antojito'],
    restTime: 0,
    calories: 560,
    washInstruction:
      'Lava el repollo y la zanahoria antes de cortarlos para el curtido. No hace falta lavar el quesillo, el frijol cocido ni el chicharrón.',
    prepInstruction:
      'Prepara primero el curtido y déjalo reposar en frío; mezcla los rellenos en un bol y divide la masa en porciones iguales.',
    finishInstruction:
      'Abre una pupusa con cuidado para comprobar que el relleno esté caliente, sirve enseguida con curtido aparte y limpia la superficie de trabajo.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras reposa el curtido en el frigorífico, divide el relleno y prepara las bolas de masa.'
      ],
      tipsAndVariations: [
        'Humedece las manos con agua para que la masa no se pegue y sella bien el borde antes de aplanar.',
        'No sobrecargues el relleno; sirve el curtido aparte para mantener la superficie dorada.'
      ]
    },
    nutrition: { calories: 560, protein: 25, carbs: 65, fat: 21, fiber: 9, sugar: 7, sodium: 900 },
    storage: {
      method:
        'Refrigera pronto, antes de 2 horas, y mantén las pupusas y el curtido separados a 5 °C o menos.',
      container: 'Dos recipientes herméticos poco profundos',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions:
        'Calienta en sartén a fuego medio hasta que el relleno esté muy caliente en el centro.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura; congela sin curtido'
    },
    sourceAttribution: salvadorSource
  },
  {
    id: 'recipe-catalog-sv-tamal-pollo',
    catalogKey: 'sv-tamal-pollo-v1',
    countryCode: 'SV',
    name: 'Tamal salvadoreño de pollo',
    description: 'Tamal de masa de maíz con pollo, envuelto en hoja de plátano.',
    cuisine: 'salvadoreña',
    mealType: ['lunch', 'dinner'],
    difficulty: 'hard',
    totalTime: 110,
    prepTime: 35,
    cookTime: 75,
    servings: 6,
    ingredients: [
      { name: 'Masa de maíz', quantity: 600, unit: 'g' },
      { name: 'Pollo', quantity: 450, unit: 'g', preparation: 'cocido y desmenuzado' },
      { name: 'Caldo de pollo', quantity: 500, unit: 'ml' },
      { name: 'Hoja de plátano', quantity: 6, unit: 'piece', substitutes: ['hoja de maíz'] },
      { name: 'Tomate', quantity: 200, unit: 'g' },
      { name: 'Patata', quantity: 180, unit: 'g', preparation: 'en cubos pequeños' },
      { name: 'Aceite', quantity: 40, unit: 'ml' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Olla vaporera', 'Sartén', 'Hilo de cocina'],
    instructionsByLevel: {
      basic: [
        step(
          'Pasa cada hoja de plátano unos segundos por una sartén caliente para que se vuelva flexible. Retírala antes de que se tueste y déjala sobre una bandeja limpia.'
        ),
        step(
          'Corta el tomate y la patata en trozos pequeños. Cocina el tomate con un poco de caldo hasta que se ablande y reserva la salsa para el relleno.'
        ),
        step(
          'Pon la masa, el aceite y la sal en un bol. Añade el caldo poco a poco y mezcla hasta obtener una masa suave que puedas extender con una cuchara, no líquida.'
        ),
        step(
          'Extiende una porción de masa sobre cada hoja. Añade pollo ya cocido, patata y un poco de tomate; deja espacio alrededor para poder cerrar el paquete.'
        ),
        step(
          'Dobla los lados de la hoja sobre el relleno y pliega los extremos para que no se salga. Ata el paquete con hilo de cocina sin apretarlo demasiado.'
        ),
        step(
          'Pon agua en la vaporera sin que toque la cesta, coloca los tamales y tapa. Mantén el agua hirviendo suavemente; comprueba que no se evapore y añade agua caliente si hace falta.',
          60
        ),
        step(
          'Saca un tamal con cuidado y déjalo reposar unos minutos. La masa debe estar firme y separarse de la hoja; si sigue húmeda, vuelve a cocer los tamales un poco más.'
        )
      ],
      intermediate: [
        step(
          'Pasa las hojas de plátano por calor para que doblen sin romperse. Prepara una salsa sencilla con tomate y parte del caldo; integra una porción en la masa para darle sabor.',
          15
        ),
        step(
          'Extiende masa sobre cada hoja, añade pollo desmenuzado y cubos de patata; cierra en paquete y cuécelo al vapor en una sola capa o por tandas.',
          60
        )
      ],
      expert: [
        step(
          'Hidrata la masa hasta que sea untable y sostenga el relleno. Dosifica por igual y deja holgura en cada envoltorio.',
          20
        ),
        step(
          'Mantén vapor constante sin que el agua toque los tamales. Termina cuando la masa se separe de la hoja y esté firme.',
          60
        )
      ]
    },
    tags: ['tradicional', 'maíz', 'envuelto'],
    restTime: 0,
    calories: 480,
    washInstruction:
      'Lava las hojas de plátano y los tomates; limpia la patata bajo el grifo. El pollo ya está cocido y desmenuzado: no lo laves.',
    prepInstruction:
      'Pasa brevemente las hojas por calor para ablandarlas, prepara paquetes iguales y mantén el pollo y el caldo refrigerados hasta usarlos.',
    finishInstruction:
      'Deja reposar los tamales unos minutos antes de abrirlos; comprueba que la masa esté firme y que el relleno esté humeante.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras se calienta la vaporera, prepara la salsa de tomate y corta la patata en dados pequeños.'
      ],
      tipsAndVariations: [
        'Si la masa queda muy espesa, añade caldo poco a poco; si las hojas se rompen, usa dos capas superpuestas.',
        'No llenes demasiado la vaporera y revisa el nivel de agua sin dejarla hervir en seco.'
      ]
    },
    nutrition: { calories: 480, protein: 23, carbs: 48, fat: 20, fiber: 5, sugar: 5, sodium: 850 },
    storage: {
      method: 'Enfría los tamales en una sola capa y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipiente hermético, con los tamales envueltos',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions:
        'Recalienta al vapor o en microondas cubierto hasta que el centro esté muy caliente.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura'
    },
    sourceAttribution: salvadorSource
  },
  {
    id: 'recipe-catalog-sv-empanadas-platano',
    catalogKey: 'sv-empanadas-platano-v1',
    countryCode: 'SV',
    name: 'Empanadas salvadoreñas de plátano y frijol',
    description: 'Bocados dulces de plátano maduro con relleno de frijol y azúcar.',
    cuisine: 'salvadoreña',
    mealType: ['snack', 'dessert'],
    difficulty: 'medium',
    totalTime: 45,
    prepTime: 20,
    cookTime: 25,
    servings: 6,
    ingredients: [
      { name: 'Plátano maduro', quantity: 5, unit: 'unit' },
      {
        name: 'Frijol refrito',
        quantity: 200,
        unit: 'g',
        substitutes: ['frijoles cocidos triturados']
      },
      { name: 'Azúcar', quantity: 35, unit: 'g' },
      { name: 'Aceite', quantity: 300, unit: 'ml' },
      { name: 'Sal', quantity: 2, unit: 'g' }
    ],
    utensils: ['Olla', 'Sartén', 'Espumadera'],
    instructionsByLevel: {
      basic: [
        step(
          'Pon los plátanos enteros y con piel en una olla con agua. Hiérvelos hasta que puedas atravesarlos fácilmente con un tenedor; luego escúrrelos con cuidado.',
          15
        ),
        step(
          'Espera a que estén lo bastante tibios para manipularlos. Pela los plátanos, ponlos en un bol y aplástalos con la sal hasta que no queden trozos grandes.'
        ),
        step(
          'Deja que la masa pierda calor para poder tocarla sin quemarte. Divide en porciones, aplana cada una en la mano y coloca una cucharada de frijol espeso en el centro.'
        ),
        step(
          'Cierra la masa alrededor del frijol y presiona la unión con los dedos. Comprueba que no haya grietas por donde pueda salirse el relleno al freír.'
        ),
        step(
          'Calienta el aceite en una sartén amplia a fuego medio. Fríe pocas empanadas cada vez y dales la vuelta cuando la parte inferior esté dorada; no dejes el aceite sin vigilancia.',
          20
        ),
        step(
          'Retíralas con una espumadera y déjalas escurrir sobre una rejilla o papel limpio. Añade el azúcar cuando aún estén tibias.'
        )
      ],
      intermediate: [
        step(
          'Cuece y pela los plátanos; machácalos mientras sigan tibios hasta obtener una masa moldeable. Si se pega, engrasa ligeramente las manos.',
          15
        ),
        step(
          'Aplana porciones, coloca frijol espeso en el centro y sella. Fríe en tandas pequeñas hasta que la superficie quede dorada y escurre antes de azucarar.',
          20
        )
      ],
      expert: [
        step(
          'Usa plátanos maduros, evita añadir líquido y enfría la masa. Mantén el relleno alejado del borde.',
          18
        ),
        step(
          'Fríe a temperatura moderada hasta dorar; escurre en rejilla y espolvorea azúcar en tibio.',
          18
        )
      ]
    },
    tags: ['tradicional', 'postre', 'plátano'],
    restTime: 0,
    calories: 390,
    washInstruction:
      'Lava los plátanos con piel antes de pelarlos y sécalos. No laves el frijol refrito ni los demás ingredientes envasados.',
    prepInstruction:
      'Prepara una olla para cocer los plátanos, un bol para machacarlos y una sartén amplia; mantén el relleno espeso para poder sellarlo.',
    finishInstruction:
      'Escurre cada empanada sobre una rejilla o papel limpio y añade azúcar cuando aún esté templada; deja que pierda calor antes de guardar.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras se cuecen los plátanos, calienta el frijol a fuego suave y prepara papel absorbente lejos del fuego.'
      ],
      tipsAndVariations: [
        'Machaca los plátanos mientras siguen tibios y engrasa ligeramente las manos si la masa se pega.',
        'Fríe en tandas pequeñas para que la temperatura del aceite no baje demasiado; puedes omitir el azúcar final.'
      ]
    },
    nutrition: { calories: 390, protein: 8, carbs: 66, fat: 12, fiber: 5, sugar: 24, sodium: 350 },
    storage: {
      method: 'Retira el exceso de aceite y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipiente hermético con papel absorbente cambiado si se humedece',
      duration: '1 día como orientación conservadora',
      reheatingInstructions:
        'Recalienta en sartén o mini horno hasta que esté muy caliente; evita repetir el recalentado.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura; congela sin azúcar final'
    },
    sourceAttribution: salvadorSource
  },
  {
    id: 'recipe-catalog-sv-yuca-chicharron',
    catalogKey: 'sv-yuca-chicharron-v1',
    countryCode: 'SV',
    name: 'Yuca con chicharrón',
    description: 'Yuca sancochada con chicharrón y curtido fresco.',
    cuisine: 'salvadoreña',
    mealType: ['lunch', 'snack'],
    difficulty: 'easy',
    totalTime: 50,
    prepTime: 15,
    cookTime: 35,
    servings: 4,
    ingredients: [
      { name: 'Yuca', quantity: 800, unit: 'g', preparation: 'pelada y en trozos' },
      {
        name: 'Chicharrón',
        quantity: 250,
        unit: 'g',
        isOptional: true,
        substitutes: ['setas salteadas para una versión sin carne']
      },
      { name: 'Repollo', quantity: 250, unit: 'g' },
      { name: 'Tomate', quantity: 250, unit: 'g' },
      { name: 'Pepino', quantity: 150, unit: 'g' },
      { name: 'Vinagre', quantity: 80, unit: 'ml' },
      { name: 'Agua', quantity: 1.5, unit: 'l' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Olla', 'Bol', 'Cuchillo'],
    instructionsByLevel: {
      basic: [
        step(
          'Corta la yuca en trozos de tamaño parecido para que se cuezan a la vez. Ponlos en una olla, cúbrelos con el agua y añade la sal.'
        ),
        step(
          'Lleva el agua a ebullición y baja el fuego para mantener un hervor constante, sin salpicaduras. Cocina hasta que un cuchillo entre en el centro sin resistencia y los bordes empiecen a abrirse.',
          25
        ),
        step(
          'Mientras se cuece la yuca, corta el repollo en tiras finas y el tomate y el pepino en trozos pequeños. Ponlos en un bol con el vinagre y una pizca de sal; mezcla y refrigera.'
        ),
        step(
          'Escurre la yuca con un colador. Si ves una fibra dura en el centro, retírala con un cuchillo cuando la yuca se pueda manipular sin quemarte.'
        ),
        step(
          'Reparte la yuca caliente en los platos. Añade el chicharrón al final para que conserve su textura y sirve el curtido aparte o encima, como prefieras.'
        )
      ],
      intermediate: [
        step(
          'Corta la yuca en trozos similares y cuécela en agua con sal hasta que se abra ligeramente y el centro esté blando. Escurre con cuidado.',
          25
        ),
        step(
          'Prepara el curtido con repollo fino, tomate y pepino. Reparte en platos y añade el chicharrón justo antes de servir para mantener su textura.',
          10
        )
      ],
      expert: [
        step(
          'Cuece la yuca a hervor suave hasta que ceda al cuchillo; retira la fibra central si está dura.',
          25
        ),
        step(
          'Reposa el curtido y sirve los componentes separados para conservar temperatura y textura.',
          10
        )
      ]
    },
    tags: ['tradicional', 'yuca', 'antojito'],
    restTime: 0,
    calories: 570,
    washInstruction:
      'Lava la yuca, el repollo, el tomate y el pepino antes de pelar o cortar. Usa tabla limpia para la yuca y retira toda la corteza gruesa.',
    prepInstruction:
      'Corta la yuca en piezas similares, prepara agua suficiente en una olla y deja listo un bol limpio para mezclar el curtido.',
    finishInstruction:
      'Comprueba que la yuca esté completamente tierna hasta el centro, escurre y sirve caliente con el curtido y el chicharrón aparte.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras hierve la yuca, corta las verduras del curtido en una tabla aparte y refrigéralo tapado.'
      ],
      tipsAndVariations: [
        'La yuca debe quedar tierna por completo; retira la fibra central si resulta dura al comer.',
        'Añade el chicharrón al final para conservar su textura y ajusta el vinagre del curtido al gusto.'
      ]
    },
    nutrition: { calories: 570, protein: 18, carbs: 80, fat: 20, fiber: 8, sugar: 14, sodium: 800 },
    storage: {
      method: 'Guarda yuca y curtido por separado y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipientes herméticos poco profundos',
      duration: '1 día como orientación conservadora',
      reheatingInstructions:
        'Recalienta la yuca con un poco de agua hasta que esté humeante en el centro.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura; no congeles el curtido'
    },
    sourceAttribution: salvadorSource
  },
  {
    id: 'recipe-catalog-sv-pastelitos-carne',
    catalogKey: 'sv-pastelitos-carne-v1',
    countryCode: 'SV',
    name: 'Pastelitos salvadoreños de carne',
    description: 'Empanaditas de masa de maíz fritas con relleno de carne y vegetales.',
    cuisine: 'salvadoreña',
    mealType: ['snack', 'dinner'],
    difficulty: 'medium',
    totalTime: 60,
    prepTime: 30,
    cookTime: 25,
    servings: 6,
    ingredients: [
      { name: 'Masa de maíz', quantity: 500, unit: 'g' },
      {
        name: 'Carne picada',
        quantity: 250,
        unit: 'g',
        substitutes: ['lentejas cocidas y escurridas']
      },
      { name: 'Patata', quantity: 150, unit: 'g', preparation: 'en cubos pequeños' },
      { name: 'Zanahoria', quantity: 100, unit: 'g', preparation: 'en cubos pequeños' },
      { name: 'Tomate', quantity: 100, unit: 'g' },
      { name: 'Aceite', quantity: 350, unit: 'ml' },
      { name: 'Agua', quantity: 200, unit: 'ml' },
      { name: 'Sal', quantity: 8, unit: 'g' }
    ],
    utensils: ['Sartén', 'Olla', 'Rodillo'],
    instructionsByLevel: {
      basic: [
        step(
          'Calienta una sartén a fuego medio y cocina la carne picada hasta que deje de verse cruda. Separa los grumos con una cuchara y usa utensilios limpios después de tocar la carne.'
        ),
        step(
          'Añade la patata, la zanahoria, el tomate, el agua y la sal. Tapa parcialmente y cocina hasta que las verduras estén tiernas; remueve de vez en cuando para que no se pegue.',
          18
        ),
        step(
          'Deja que el relleno pierda el calor y escurre cualquier líquido que quede. Debe estar jugoso, pero no soltar agua al ponerlo sobre la masa.'
        ),
        step(
          'Mezcla la masa con el agua poco a poco hasta que sea fácil de moldear. Divide en porciones iguales y aplana cada una sobre una superficie limpia.'
        ),
        step(
          'Pon una cucharada de relleno en una mitad de cada disco, deja libre el borde, dobla la otra mitad encima y presiona todo el contorno para cerrarlo.'
        ),
        step(
          'Calienta el aceite a fuego medio y fríe pocos pastelitos cada vez. Dales la vuelta cuando estén dorados por debajo; sácalos con una espumadera y deja escurrir antes de servir.',
          15
        )
      ],
      intermediate: [
        step(
          'Sofríe la carne y añade los vegetales picados con un poco de agua; cocina hasta que estén tiernos y deja enfriar el relleno.',
          15
        ),
        step(
          'Aplana porciones de masa entre las manos, coloca relleno en una mitad, dobla y presiona los bordes. Fríe en aceite caliente por tandas y escurre.',
          15
        )
      ],
      expert: [
        step(
          'Reduce el relleno hasta que quede jugoso y sin líquido; enfríalo antes de formar discos uniformes.',
          18
        ),
        step(
          'Sella sin bolsas de aire y fríe a temperatura estable hasta dorar. Escurre en rejilla y sirve el curtido aparte.',
          15
        )
      ]
    },
    tags: ['tradicional', 'maíz', 'carne'],
    restTime: 5,
    calories: 420,
    washInstruction:
      'Lava la patata, zanahoria y tomate antes de cortarlos. No enjuagues la carne picada cruda; usa una tabla y utensilios separados.',
    prepInstruction:
      'Corta las verduras en dados pequeños y uniformes, prepara la masa y deja enfriar el relleno antes de montar los pastelitos.',
    finishInstruction:
      'Comprueba que la carne esté completamente cocinada y deja escurrir los pastelitos unos minutos antes de servir.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras se enfría el relleno, divide la masa y prepara una bandeja limpia para los pastelitos formados.'
      ],
      tipsAndVariations: [
        'El relleno debe quedar jugoso pero no líquido; deja que se enfríe antes de cerrar la masa.',
        'Fríe en tandas pequeñas y no llenes la sartén más de la mitad; usa una espumadera y no dejes el aceite sin vigilancia.'
      ]
    },
    nutrition: { calories: 420, protein: 16, carbs: 48, fat: 18, fiber: 5, sugar: 6, sodium: 750 },
    storage: {
      method: 'Enfría en una sola capa y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipiente hermético poco profundo',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions:
        'Calienta una sola vez en mini horno hasta que el centro esté muy caliente.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura'
    },
    sourceAttribution: salvadorSource
  },
  {
    id: 'recipe-catalog-sv-riguas',
    catalogKey: 'sv-riguas-v1',
    countryCode: 'SV',
    name: 'Riguas de elote',
    description: 'Tortitas salvadoreñas de maíz tierno cocidas envueltas en hoja de plátano.',
    cuisine: 'salvadoreña',
    mealType: ['breakfast', 'snack'],
    difficulty: 'medium',
    totalTime: 40,
    prepTime: 15,
    cookTime: 25,
    servings: 4,
    ingredients: [
      { name: 'Maíz tierno desgranado', quantity: 700, unit: 'g' },
      { name: 'Azúcar', quantity: 15, unit: 'g' },
      { name: 'Sal', quantity: 5, unit: 'g' },
      {
        name: 'Queso fresco',
        quantity: 120,
        unit: 'g',
        isOptional: true,
        substitutes: ['queso salado suave']
      },
      { name: 'Hoja de plátano', quantity: 4, unit: 'piece' },
      { name: 'Aceite', quantity: 10, unit: 'ml' }
    ],
    utensils: ['Licuadora o molino', 'Comal', 'Espátula'],
    instructionsByLevel: {
      basic: [
        step(
          'Pon el maíz en la licuadora en varias tandas y tritura con pulsos cortos. Para y revisa la textura: debe quedar una pasta espesa con algunos trocitos, no un líquido.'
        ),
        step(
          'Pasa la pasta a un bol, añade la sal y el azúcar y mezcla hasta que estén repartidas. Si la masa se escurre de la cuchara, déjala reposar un momento para que espese.'
        ),
        step(
          'Calienta las hojas de plátano unos segundos sobre el comal para que se doblen sin romperse. Extiende una gota de aceite en cada hoja y coloca una porción de masa en el centro.'
        ),
        step(
          'Si quieres, pon un poco de queso fresco sobre la masa. Dobla la hoja para cubrirla y aplana suavemente hasta dejar una tortita de grosor parecido por todas partes.'
        ),
        step(
          'Coloca las hojas sobre el comal a fuego medio. Cuando la base esté firme y dorada, dales la vuelta con una espátula; cocina hasta que ambos lados estén dorados y el centro firme.',
          22
        ),
        step(
          'Retira las riguas y déjalas reposar un minuto antes de abrir la hoja. Sirve calientes; si la masa sigue húmeda en el centro, cocínalas un poco más a fuego moderado.'
        )
      ],
      intermediate: [
        step(
          'Tritura el maíz por pulsos para conservar algo de textura; si suelta mucho líquido, escúrrelo un poco. Sazona y calienta las hojas para volverlas flexibles.',
          10
        ),
        step(
          'Pon una porción en cada hoja, añade queso opcional y dobla. Cocina sobre comal engrasado a fuego medio, volteando una vez cuando la base se desprenda.',
          22
        )
      ],
      expert: [
        step(
          'Ajusta por escurrido una masa húmeda que no se deslice; dosifica porciones de grosor uniforme.',
          10
        ),
        step(
          'Dora sobre hoja a fuego medio y voltea cuando la base se desprenda. Sirve al cuajar.',
          20
        )
      ]
    },
    tags: ['tradicional', 'maíz', 'desayuno'],
    restTime: 0,
    calories: 290,
    washInstruction:
      'Lava las hojas de plátano y enjuaga brevemente el maíz desgranado; escúrrelo. Seca las hojas antes de ponerlas sobre la plancha.',
    prepInstruction:
      'Tritura el maíz por pulsos para conservar algo de textura, mezcla sal y azúcar y corta las hojas en piezas que cubran cada porción.',
    finishInstruction:
      'Retira las riguas cuando estén firmes y doradas por ambos lados; sírvelas calientes, con queso fresco opcional.',
    guidance: {
      appliances: ['Cocina de gas'],
      parallelTasks: [
        'Mientras se calienta el comal, corta las hojas y prepara el queso para servir.'
      ],
      tipsAndVariations: [
        'Si la masa queda demasiado líquida, escúrrela un poco; evita añadir harina para conservar el sabor del maíz.',
        'Cocina las porciones del mismo grosor y dales la vuelta cuando los bordes se vean firmes.'
      ]
    },
    nutrition: { calories: 290, protein: 7, carbs: 51, fat: 7, fiber: 5, sugar: 10, sodium: 550 },
    storage: {
      method: 'Deja que pierdan el vapor fuerte y refrigera antes de 2 horas a 5 °C o menos.',
      container: 'Recipiente hermético, separando las piezas con papel de horno',
      duration: '1–2 días como orientación conservadora',
      reheatingInstructions: 'Calienta en comal o sartén hasta que esté muy caliente en el centro.',
      freezingPossible: true,
      freezingDuration: 'Hasta 1 mes para mejor textura'
    },
    sourceAttribution: maizeSource
  }
];

const UPSERT_RECIPE = `
  INSERT OR IGNORE INTO recipes (
    id, catalog_key, country_code, source_attribution, name, description, difficulty, cuisine,
    meal_type, total_time, prep_time, cook_time, rest_time, servings, calories, image, ingredients,
    utensils, steps, recipe_guidance, nutrition, storage, author, author_id, tags, is_favorite, is_public
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'catalog', NULL, ?, 0, 1)
  ON CONFLICT(id) DO UPDATE SET
    catalog_key = excluded.catalog_key,
    country_code = excluded.country_code,
    source_attribution = excluded.source_attribution,
    name = excluded.name,
    description = excluded.description,
    difficulty = excluded.difficulty,
    cuisine = excluded.cuisine,
    meal_type = excluded.meal_type,
    total_time = excluded.total_time,
    prep_time = excluded.prep_time,
    cook_time = excluded.cook_time,
    rest_time = excluded.rest_time,
    servings = excluded.servings,
    calories = excluded.calories,
    ingredients = excluded.ingredients,
    utensils = excluded.utensils,
    steps = excluded.steps,
    recipe_guidance = excluded.recipe_guidance,
    nutrition = excluded.nutrition,
    storage = excluded.storage,
    tags = excluded.tags
  WHERE recipes.author = 'catalog'
`;

/**
 * Inserta o refresca el contenido editorial propio sin pisar recetas de usuario, sus portadas,
 * favoritos, valoraciones, historial de cocina o notas personales.
 */
export function ensureRecipeBookCatalog(db: Database.Database): number {
  const upsert = db.prepare(UPSERT_RECIPE);
  const exists = db.prepare('SELECT 1 FROM recipes WHERE id = ?');
  const serializeInstructions = (recipe: RecipeBookSeed) =>
    JSON.stringify(
      Object.fromEntries(
        (['basic', 'intermediate', 'expert'] as const).map((level) => [
          level,
          [
            step(recipe.washInstruction),
            step(recipe.prepInstruction),
            ...recipe.instructionsByLevel[level],
            step(recipe.finishInstruction)
          ].map((instruction, index) => ({ ...instruction, stepNumber: index + 1 }))
        ])
      )
    );
  const seed = db.transaction(() => {
    let inserted = 0;
    for (const recipe of RECIPE_BOOK_SEEDS) {
      const existed = exists.get(recipe.id) !== undefined;
      const changes = upsert.run(
        recipe.id,
        recipe.catalogKey,
        recipe.countryCode,
        JSON.stringify(recipe.sourceAttribution),
        recipe.name,
        recipe.description,
        recipe.difficulty,
        recipe.cuisine,
        JSON.stringify(recipe.mealType),
        recipe.totalTime,
        recipe.prepTime,
        recipe.cookTime,
        recipe.restTime,
        recipe.servings,
        recipe.calories,
        JSON.stringify(recipe.ingredients),
        JSON.stringify(recipe.utensils),
        serializeInstructions(recipe),
        JSON.stringify(recipe.guidance),
        JSON.stringify(recipe.nutrition),
        JSON.stringify(recipe.storage),
        JSON.stringify(recipe.tags)
      ).changes;
      if (!existed) inserted += changes;
    }
    return inserted;
  });
  return seed();
}

/** Retira únicamente seeds no referenciadas; nunca borra favoritos/notas ya creados por personas. */
export function removeUnusedRecipeBookCatalog(db: Database.Database): number {
  const keys = RECIPE_BOOK_SEEDS.map(({ catalogKey }) => catalogKey);
  const placeholders = keys.map(() => '?').join(', ');
  return db
    .prepare(
      `DELETE FROM recipes
       WHERE author = 'catalog' AND catalog_key IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM user_recipes WHERE user_recipes.recipe_id = recipes.id)`
    )
    .run(...keys).changes;
}
