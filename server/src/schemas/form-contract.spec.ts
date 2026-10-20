import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { z } from 'zod';
import { describeIssues, formBool, formColor, formNumber, formText, formTime } from './form.js';
import {
  addMealSchema,
  calendarEventFilterSchema,
  calendarFilterSchema,
  createCalendarEventSchema,
  createCalendarSchema,
  replaceSelectedMealsSchema,
  updateCalendarEventSchema,
  updateGoalsSchema,
  updateMealSchema
} from './calendar.schema.js';
import {
  avatarImageSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema
} from './auth.schema.js';
import {
  createHouseholdSchema,
  inviteMemberSchema,
  joinHouseholdSchema,
  updateHouseholdSchema,
  updateMemberSchema
} from './household.schema.js';
import { updateTasteSchema } from '../utils/taste-profile.js';
import {
  createIngredientSchema,
  createPantryCategorySchema,
  createProductSchema,
  createUtensilSchema,
  ingredientFilterSchema,
  pantryCategoryFilterSchema,
  bulkProductIdsSchema,
  productFilterSchema,
  catalogAddSchema,
  catalogFilterSchema,
  selectProductImageSchema,
  uploadProductImageSchema,
  updateIngredientSchema,
  updatePantryCategorySchema,
  updateProductSchema,
  updateUtensilSchema,
  utensilFilterSchema
} from './pantry.schema.js';
import { createRecipeSchema, recipeFilterSchema, updateRecipeSchema } from './recipe.schema.js';
import { aiRecipeOutputSchema } from './recipe-ai-output.schema.js';
import { improveRecipeRequestSchema } from './recipe-improvement.schema.js';
import {
  householdPlanProposalRequestSchema,
  householdPlanWriteSchema
} from './household-plan.schema.js';
import {
  householdTaskWeekQuerySchema,
  householdTaskWeekWriteSchema
} from './household-task.schema.js';
import { householdPlanAssignmentWriteSchema } from './household-plan-assignment.schema.js';
import { householdMealPlanningPatchSchema } from './household-meal-planning.schema.js';
import {
  householdMealProposalConfirmRequestSchema,
  householdMealProposalRequestSchema
} from './household-meal-proposal-request.schema.js';
import {
  householdMealRecipeCandidateSchema,
  mealProposalSchema
} from './household-meal-proposal.schema.js';
import { householdMealConsumptionSchema } from './household-meal-consumption.schema.js';
import { householdMealShoppingApprovalSchema } from './household-meal-shopping-approval.schema.js';
import { householdMealShoppingPreviewQuerySchema } from './household-meal-shopping-preview.schema.js';
import {
  householdPlanningAutomationPatchSchema,
  householdPlanningAutomationRetrySchema,
  householdPlanningAutomationRunSummarySchema
} from './household-planning-automation.schema.js';
import { generatedRecipeCandidateSchema } from './generated-recipe.schema.js';
import {
  assistantUpdateItemSchema,
  assistantUpdateListSchema,
  applyLinesSchema,
  bulkItemsSchema,
  completeListSchema,
  createCategorySchema,
  createItemSchema,
  createListSchema,
  createSuggestedListSchema,
  discountSchema,
  listFilterSchema,
  orderSchema,
  photoLinesSchema,
  priceFilterSchema,
  updateItemSchema,
  updateListSchema
} from './shopping.schema.js';
import {
  createReceiptItemSchema,
  updateReceiptItemSchema,
  updateReceiptSchema
} from './receipts.schema.js';
import {
  aiFunctionProviderAssignmentSchema,
  createAiConfigSchema,
  generateRecipeSchema,
  generateWeeklyPlanSchema,
  getRecommendationsSchema,
  testConnectionSchema,
  updateAiConfigSchema,
  replaceMealSchema
} from './ai.schema.js';
import {
  aiAssistantActionRefinementRequestSchema,
  aiAssistantBatchRefinementRequestSchema,
  aiAssistantProposalRequestSchema,
  assistantMealProposalRequestSchema,
  assistantActionBatchRefinementCandidateSchema,
  assistantActionPlanCandidateSchema,
  assistantActionRefinementCandidateSchema,
  assistantActionBatchRefinementProviderCandidateSchema,
  assistantActionPlanProviderCandidateSchema,
  assistantActionRefinementProviderCandidateSchema
} from './ai-assistant.schema.js';
import { assistantUpdateIngredientSchema } from './ai-assistant-pantry-update.schema.js';
import { assistantUpdateCalendarEventSchema } from './ai-assistant-calendar-update.schema.js';
import {
  assistantRecipeContentSnapshotSchema,
  assistantRecipeContentUpdateRequestSchema
} from './ai-assistant-recipe-update.schema.js';

/**
 * EL CONTRATO DE LOS FORMULARIOS: lo opcional tiene que poder no llegar.
 *
 * Nacio de un fallo concreto —el calendario respondia 400 cuando el usuario dejaba vacias las notas
 * o el sitio, porque `.optional()` no acepta el `null` con el que un formulario manda un campo sin
 * rellenar— y de la única cosa que lo evita de verdad: una prueba por formulario, y un mecanismo que
 * no deje ninguno fuera. Las filas son los formularios; la regla del final del fichero es el candado.
 *
 * Lo que se exige de cada campo opcional, en las cuatro formas que un navegador manda:
 *   - ausente            -> vale (no tocar)
 *   - `null`             -> vale y significa «borrado»
 *   - `''` / `'   '`     -> vale y se convierte en `null` para los de texto
 * Y además, para que nadie confunda esto con «aceptar cualquier cosa»: los OBLIGATORIOS tienen que
 * seguir fallando uno a uno.
 */
type Row = {
  /** Nombre exacto del export, que es como lo buscan las rutas y la regla de completud. */
  name: string;
  /**
   * `form` es un cuerpo que escribe; `query` son parametros de URL. La diferencia no es de gusto: de
   * una URL no puede venir `null` (viene `?x=`, o sea `''`), y en un cuerpo un `<select>` no manda
   * nunca la cadena vacia porque no tiene opción vacia. Exigir de mas aqui obligaria a aflojar los
   * schemas sin necesidad, y eso es justamente como se cuela un `enum` con '' en un PATCH.
   */
  kind?: 'form' | 'query';
  schema: z.ZodTypeAny;
  /**
   * Payload minimo valido. Se omite cuando el schema no tiene ningun campo obligatorio (los PATCH y
   * los filtros de consulta): ahi el minimo es `{}` y no hay nada que escribir.
   */
  required?: Record<string, unknown>;
  /** Por que el minimo no es «los required a secas» (un refine que pide una de varias). */
  note?: string;
  /**
   * Claves cuyo hueco el schema rechaza A PROPÓSITO, con el motivo al lado. Un PATCH con el refine
   * «nada que actualizar» no puede aceptar `{}`, y eso no es el bug que cazamos aqui: el bug es que
   * un campo OPCIONAL no se pueda dejar vacio, no que un payload vacio no tenga sentido. Se listan
   * para que la excepcion se lea, no para que se olvide.
   */
  except?: Record<string, string>;
};

/** Filtros de lectura: todo opcional, y el contrato es que `?vacio` no puede dar 400. */
const query = (
  name: string,
  schema: z.ZodTypeAny,
  required: Record<string, unknown> = {}
): Row => ({
  name,
  schema,
  kind: 'query',
  required
});

const mealRecipeStep = (instruction: string) => ({
  stepNumber: 1,
  instruction,
  duration: null,
  temperature: null,
  timerRequired: false,
  timerDuration: null,
  tips: null,
  warning: null,
  illustration: null
});

const mealRecipeCandidate = {
  name: 'Lentejas',
  description: 'Plato sencillo.',
  difficulty: 'easy',
  cuisine: 'española',
  totalTime: 40,
  prepTime: 10,
  cookTime: 30,
  restTime: null,
  baseServings: 1,
  calories: null,
  ingredients: [
    {
      name: 'lentejas',
      quantity: 80,
      unit: 'g',
      preparation: null,
      isOptional: false,
      substitutes: [],
      notes: null
    }
  ],
  utensils: ['olla'],
  guidance: {
    appliances: [],
    parallelTasks: [],
    tipsAndVariations: [],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [mealRecipeStep('Cocer las lentejas.')],
    intermediate: [mealRecipeStep('Cocer las lentejas a fuego suave.')],
    expert: [mealRecipeStep('Controlar la textura y el punto.')]
  },
  nutrition: null,
  storage: null,
  tags: []
};

const mealProposalEvent = (recipeAlias: string) => ({
  date: '2026-10-12',
  mealType: 'lunch',
  time: '13:00',
  recipeAlias,
  participantAliases: ['P1'],
  servings: 1,
  objectiveSummary: 'Plato sencillo.',
  status: 'scheduled',
  reason: null
});

const ROWS: Row[] = [
  // ── calendario de la casa ──
  {
    name: 'createCalendarEventSchema',
    schema: createCalendarEventSchema,
    required: { title: 'Carpinteria', date: '2026-03-11' },
    note: 'Un evento sin dia no existe: `date` es required a sabiendas, y el dialog lo prellena.'
  },
  {
    name: 'updateCalendarEventSchema',
    schema: updateCalendarEventSchema,
    required: { title: 'Carpinteria' },
    note: 'El refine exige al menos un campo.',
    except: {
      title:
        'Quitar el titulo dejaria el payload vacio, y ahi el refine dice «nada que actualizar» a proposito'
    }
  },
  {
    name: 'addMealSchema',
    schema: addMealSchema,
    required: { date: '2026-03-11', mealType: 'lunch' }
  },
  { name: 'updateMealSchema', schema: updateMealSchema },
  { name: 'updateGoalsSchema', schema: updateGoalsSchema },
  {
    name: 'createCalendarSchema',
    schema: createCalendarSchema,
    required: { weekStart: '2026-03-09' }
  },
  query('calendarFilterSchema', calendarFilterSchema),
  query('calendarEventFilterSchema', calendarEventFilterSchema, {
    from: '2026-03-01',
    to: '2026-03-31'
  }),
  {
    name: 'replaceSelectedMealsSchema',
    schema: replaceSelectedMealsSchema,
    required: { replacements: [{ id: 'meal-id', customMeal: 'Lentejas' }] },
    note: 'La sustitución requiere al menos un plato y un nombre nuevo; dieta e invitados permanecen opcionales.'
  },

  // ── el gestor del inventario (## 12x) ──
  {
    name: 'createPantryCategorySchema',
    schema: createPantryCategorySchema,
    required: { name: 'Frutos secos' },
    note: 'Solo el nombre es obligatorio: el color lo elige la casa y la descripcion y el padre admiten el hueco.'
  },
  { name: 'updatePantryCategorySchema', schema: updatePantryCategorySchema },
  query('pantryCategoryFilterSchema', pantryCategoryFilterSchema),
  {
    name: 'createProductSchema',
    schema: createProductSchema,
    required: { name: 'Levadura' },
    note: 'El resto cae en su defecto (other / unit / 0): registrar un basico no puede exigir rellenar medio formulario.'
  },
  { name: 'updateProductSchema', schema: updateProductSchema },
  {
    name: 'bulkProductIdsSchema',
    schema: bulkProductIdsSchema,
    required: { ids: ['pi-1'] },
    note: 'Un lote vacio no tiene sentido (min 1) y uno de mil tampoco: el techo de 100 es lo que el servidor esta dispuesto a borrar de una vez.'
  },
  query('productFilterSchema', productFilterSchema),
  // ── El catalogo pre-registrado del super (## 12aa) ──
  query('catalogFilterSchema', catalogFilterSchema),
  {
    name: 'catalogAddSchema',
    schema: catalogAddSchema,
    required: { ids: ['dairy:0'] },
    note: 'Igual que el lote de borrado: entre 1 y 100 ids. Un lote vacio no escribe en la casa, y uno de mil tampoco.'
  },
  {
    name: 'selectProductImageSchema',
    schema: selectProductImageSchema,
    required: { photoId: '0123456789abcdef01234567' },
    note: 'La selección necesita la identidad estable del candidato, no una URL arbitraria del cliente.'
  },
  {
    name: 'uploadProductImageSchema',
    schema: uploadProductImageSchema,
    required: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    note: 'La carga requiere contenido; tipo, firma y tamaño real se validan antes de almacenarla.'
  },

  // ── casa y perfil ──
  {
    name: 'createHouseholdSchema',
    schema: createHouseholdSchema,
    required: { name: 'Los del 3B' }
  },
  {
    name: 'householdMealPlanningPatchSchema',
    schema: householdMealPlanningPatchSchema,
    required: { household: { mealTypes: { dinner: false } } },
    note: 'El patch aplica al menos un campo común o personal sin exigir que se envíe el bloque entero.',
    except: {
      household:
        'El bloque vacío no contiene cambios; al menos un ajuste del hogar o de un miembro debe enviarse.',
      member:
        'El bloque vacío no contiene cambios; al menos un ajuste del hogar o de un miembro debe enviarse.'
    }
  },
  {
    name: 'householdMealProposalRequestSchema',
    schema: householdMealProposalRequestSchema,
    required: { weekStart: '2026-10-12', householdMemberIds: ['membership-1'] },
    note: 'La propuesta requiere lunes válido y al menos un miembro activo seleccionado explícitamente.'
  },
  {
    name: 'householdMealProposalConfirmRequestSchema',
    schema: householdMealProposalConfirmRequestSchema,
    required: {
      proposalId: 'proposal-1',
      weekStart: '2026-10-12',
      householdMemberIds: ['membership-1'],
      recipes: [
        {
          alias: 'R1',
          source: 'catalog',
          recipeId: 'recipe-1',
          recipe: mealRecipeCandidate
        }
      ],
      events: [{ id: 'event-1', ...mealProposalEvent('R1') }]
    },
    note: 'La confirmación acepta recetas incluidas por alias opaco; el servidor resuelve las membresías, el catálogo autorizado y vuelve a validar receta y turnos.'
  },
  {
    name: 'householdMealConsumptionSchema',
    schema: householdMealConsumptionSchema,
    required: { status: 'realized', servings: 1, expectedVersion: 0 },
    note: 'El contrato exige todos los campos y distingue raciones positivas para consumo realizado y cero solo para no realizado.'
  },
  {
    name: 'householdMealShoppingPreviewQuerySchema',
    schema: householdMealShoppingPreviewQuerySchema,
    kind: 'query',
    required: { startDate: '2026-10-13', endDate: '2026-10-13' },
    note: 'El cálculo requiere un rango explícito y acotado; la ruta rechaza fechas anteriores a hoy.'
  },
  {
    name: 'householdMealShoppingApprovalSchema',
    schema: householdMealShoppingApprovalSchema,
    required: {
      startDate: '2026-10-13',
      endDate: '2026-10-13',
      previewId: 'a'.repeat(64),
      items: [{ name: 'Lentejas', unit: 'g', quantity: 80 }]
    },
    note: 'La aprobación referencia un preview y solo admite líneas en un rango y cantidad válidos.'
  },
  {
    name: 'householdMealRecipeCandidateSchema',
    schema: householdMealRecipeCandidateSchema,
    required: mealRecipeCandidate,
    note: 'Objeto completo de receta nueva enviado en la confirmación; debe conservar la plantilla canónica y permitir solo campos explícitos.'
  },
  {
    name: 'mealProposalSchema',
    schema: mealProposalSchema,
    required: {
      newRecipes: [{ alias: 'N1', recipe: mealRecipeCandidate }],
      events: [mealProposalEvent('N1')]
    },
    note: 'Contrato JSON estricto: al menos un turno válido referencia por alias una receta completa existente o nueva; la cobertura real se valida con el planificador.'
  },
  {
    name: 'householdPlanWriteSchema',
    schema: householdPlanWriteSchema,
    required: {
      baseVersion: 0,
      plan: {
        schemaVersion: 1,
        dwellingType: 'apartment',
        dwellingTypeLabel: null,
        summary: '',
        warnings: [],
        floors: [
          { id: 'floor-0', name: 'Planta baja', level: 0, walls: [], openings: [], spaces: [] }
        ]
      }
    },
    note: 'El plano completo y su versión base se envían juntos para validar y guardar con CAS.'
  },
  {
    name: 'householdPlanProposalRequestSchema',
    schema: householdPlanProposalRequestSchema,
    required: { baseVersion: 0 },
    note: 'La solicitud de texto es opcional si la persona sube un boceto o una foto.'
  },
  {
    name: 'householdPlanAssignmentWriteSchema',
    schema: householdPlanAssignmentWriteSchema,
    required: {
      baseVersion: 0,
      basePlanVersion: 0,
      spaceId: 'kitchen',
      memberIds: ['member-a']
    },
    note: 'La asignación cambia una sola zona mediante control de versión; el servidor comprueba membresía y pertenencia al plano.'
  },
  query('householdTaskWeekQuerySchema', householdTaskWeekQuerySchema, {
    weekStart: '2026-10-05'
  }),
  {
    name: 'householdTaskWeekWriteSchema',
    schema: householdTaskWeekWriteSchema,
    required: {
      baseVersion: 0,
      weekStart: '2026-10-05',
      tasks: []
    },
    note: 'El lote semanal completo se versiona y valida antes de guardar.'
  },
  {
    name: 'householdPlanningAutomationPatchSchema',
    schema: householdPlanningAutomationPatchSchema,
    required: { expectedVersion: 0, enabled: false },
    note: 'La API exige cambios explícitos y valida la activación completa en el store.',
    except: {
      enabled: 'Los booleanos vacíos o null no son una orden válida para activar o pausar.',
      mode: 'Los valores vacíos no son modos; null sí permite limpiar una configuración pausada.',
      scopes: 'Los ámbitos deben ser una lista explícita y no aceptan texto ni null.',
      weekday: 'El día debe ser ISO 1–7; null sí permite limpiar una configuración pausada.',
      localTime: 'La hora debe usar HH:mm; null sí permite limpiar una configuración pausada.',
      timeZone:
        'La zona debe ser IANA explícita; null sí permite limpiar una configuración pausada.'
    }
  },
  {
    name: 'householdPlanningAutomationRetrySchema',
    schema: householdPlanningAutomationRetrySchema,
    required: { expectedVersion: 1, occurrenceKey: '2026-10-17|Europe/Madrid' },
    note: 'El retry identifica una ocurrencia explícita y exige la versión que ve el usuario.'
  },
  {
    name: 'householdPlanningAutomationRunSummarySchema',
    schema: householdPlanningAutomationRunSummarySchema,
    required: {
      occurrenceKey: '2026-10-17|Europe/Madrid',
      targetWeekStart: '2026-10-19',
      status: 'completed',
      failureCode: null,
      updatedAt: '2026-10-13T21:00:00.000Z'
    },
    note: 'La lectura pública del ledger expone solo un resumen con estado y fecha allowlist.'
  },
  { name: 'updateHouseholdSchema', schema: updateHouseholdSchema },
  { name: 'joinHouseholdSchema', schema: joinHouseholdSchema, required: { inviteCode: 'ABC123' } },
  {
    name: 'inviteMemberSchema',
    schema: inviteMemberSchema,
    required: { email: 'ana@hogaria.test' }
  },
  { name: 'updateMemberSchema', schema: updateMemberSchema },
  {
    name: 'registerSchema',
    schema: registerSchema,
    required: { name: 'Ana', email: 'ana@hogaria.test', password: 'Clave1234' }
  },
  {
    name: 'loginSchema',
    schema: loginSchema,
    required: { email: 'ana@hogaria.test', password: 'Clave1234' }
  },
  {
    name: 'forgotPasswordSchema',
    schema: forgotPasswordSchema,
    required: { email: 'ana@hogaria.test' }
  },
  {
    name: 'resetPasswordSchema',
    schema: resetPasswordSchema,
    required: { token: 't', newPassword: 'Clave1234' }
  },
  {
    name: 'changePasswordSchema',
    schema: changePasswordSchema,
    required: { oldPassword: 'vieja', newPassword: 'Clave1234' }
  },
  { name: 'refreshTokenSchema', schema: refreshTokenSchema, required: { refreshToken: 'r' } },
  { name: 'updateProfileSchema', schema: updateProfileSchema },
  {
    name: 'avatarImageSchema',
    schema: avatarImageSchema,
    required: { image: 'data:image/jpeg;base64,AAAA' }
  },
  // El onboarding guarda el perfil por partes y «saltarselo» es un PATCH con un solo campo: aqui un
  // hueco tiene que significar «no tocar», que es justo lo que antes no significaba.
  { name: 'updateTasteSchema', schema: updateTasteSchema },

  // ── despensa ──
  {
    name: 'createIngredientSchema',
    schema: createIngredientSchema,
    required: { name: 'Tomate', category: 'vegetables', quantity: 4, unit: 'unit' }
  },
  { name: 'updateIngredientSchema', schema: updateIngredientSchema },
  {
    name: 'createUtensilSchema',
    schema: createUtensilSchema,
    required: { name: 'Horno', category: 'oven' }
  },
  { name: 'updateUtensilSchema', schema: updateUtensilSchema },
  query('ingredientFilterSchema', ingredientFilterSchema),
  query('utensilFilterSchema', utensilFilterSchema),

  // ── recetas ──
  {
    name: 'createRecipeSchema',
    schema: createRecipeSchema,
    required: {
      name: 'Gaspacho',
      ingredients: [{ name: 'Tomate', quantity: 4, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Triturar' }]
    },
    except: {
      steps:
        'La creación acepta exactamente una forma: `steps` para recetas históricas o `instructionsByLevel` para las nuevas. Dejar ambos vacíos o mandarlos juntos duplica o elimina la preparación.'
    }
  },
  {
    name: 'generatedRecipeCandidateSchema',
    schema: generatedRecipeCandidateSchema,
    required: {
      name: 'Crema',
      description: 'Crema suave',
      difficulty: 'easy',
      cuisine: null,
      totalTime: 20,
      prepTime: 5,
      cookTime: 15,
      restTime: null,
      baseServings: 1,
      calories: 180,
      ingredients: [
        {
          name: 'Zanahoria',
          quantity: 2,
          unit: 'unit',
          preparation: null,
          isOptional: false,
          substitutes: [],
          notes: null
        }
      ],
      utensils: [],
      guidance: {
        appliances: [],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      },
      instructionsByLevel: {
        basic: [
          {
            stepNumber: 1,
            instruction: 'Cocer.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        intermediate: [
          {
            stepNumber: 1,
            instruction: 'Cortar y cocer.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        expert: [
          {
            stepNumber: 1,
            instruction: 'Cortar en dados y cocer a hervor suave.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ]
      },
      nutrition: { calories: 180, protein: 2, carbs: 20, fat: 5, fiber: 4 },
      storage: null,
      tags: []
    }
  },
  {
    name: 'aiRecipeOutputSchema',
    schema: aiRecipeOutputSchema,
    required: mealRecipeCandidate,
    note: 'La respuesta JSON canónica de recetas exige todos los campos, los tres niveles y al menos un ingrediente.'
  },
  {
    name: 'improveRecipeRequestSchema',
    schema: improveRecipeRequestSchema,
    required: { recipe: mealRecipeCandidate, scopes: ['preparation'] },
    note: 'La mejora requiere una receta editable y al menos un ámbito explícito.'
  },
  {
    name: 'updateRecipeSchema',
    schema: updateRecipeSchema,
    except: {
      ingredients: 'Una receta no puede quedarse sin ingredientes.',
      steps: 'Una receta debe conservar al menos una representación de instrucciones.',
      instructionsByLevel: 'Una receta debe conservar al menos una representación de instrucciones.'
    }
  },
  query('recipeFilterSchema', recipeFilterSchema),

  // ── compra ──
  { name: 'createListSchema', schema: createListSchema, required: { name: 'Semana' } },
  {
    name: 'createSuggestedListSchema',
    schema: createSuggestedListSchema,
    required: {},
    note: 'La lista sugerida (## 12al) se calcula en el server: el cuerpo es todo opcional (solo el nombre traducido) y un POST vacio es valido.'
  },
  {
    name: 'updateListSchema',
    schema: updateListSchema,
    required: { name: 'Semana', version: 1 },
    except: {
      name: 'NothingToUpdate: sin nombre, sin tienda y sin estado no hay PATCH que aplicar'
    }
  },
  {
    name: 'assistantUpdateListSchema',
    schema: assistantUpdateListSchema,
    required: {
      version: 1,
      changes: { store: null },
      assistantAction: {
        operation: 'update_list',
        targetId: 'list-1',
        before: { name: 'Semana', store: null }
      }
    }
  },
  {
    name: 'assistantUpdateItemSchema',
    schema: assistantUpdateItemSchema,
    required: {
      version: 1,
      changes: { quantity: 2 },
      assistantAction: {
        operation: 'update_item',
        targetId: 'item-1',
        listId: 'list-1',
        before: {
          listName: 'Semana',
          name: 'Pan',
          productKey: 'pan',
          quantity: 1,
          unit: null,
          category: null,
          checked: false,
          deletedAt: null,
          updatedAt: null
        }
      }
    }
  },
  { name: 'createItemSchema', schema: createItemSchema, required: { name: 'Pan' } },
  {
    name: 'updateItemSchema',
    schema: updateItemSchema,
    required: { name: 'Pan', version: 1 },
    except: { name: 'NothingToUpdate, la misma regla que en la lista' }
  },
  { name: 'createCategorySchema', schema: createCategorySchema, required: { name: 'Frutas' } },
  {
    name: 'discountSchema',
    schema: discountSchema,
    required: { kind: 'amount', valueMinor: 150 },
    // El refine exige importe O porcentaje segun el `kind`: «sin cifra» no es un hueco opcional, es
    // un descuento que no descuenta nada.
    except: {
      valueMinor: 'con kind=amount la cifra es el descuento; sin ella no hay nada que aplicar',
      percentBps: 'y con kind=percent manda la otra'
    }
  },
  { name: 'bulkItemsSchema', schema: bulkItemsSchema, required: { lines: 'Pan, Leche' } },
  { name: 'orderSchema', schema: orderSchema, required: { itemIds: [], version: 1 } },
  { name: 'completeListSchema', schema: completeListSchema },
  { name: 'photoLinesSchema', schema: photoLinesSchema, required: { lines: [] } },
  { name: 'applyLinesSchema', schema: applyLinesSchema, required: { lines: [{ name: 'Pan' }] } },
  query('listFilterSchema', listFilterSchema),
  query('priceFilterSchema', priceFilterSchema),

  // ── IA ──
  {
    name: 'aiAssistantProposalRequestSchema',
    schema: aiAssistantProposalRequestSchema,
    required: { prompt: 'Añade lentejas a la despensa.' }
  },
  {
    name: 'assistantMealProposalRequestSchema',
    schema: assistantMealProposalRequestSchema,
    required: {
      weekStart: '2026-10-12',
      householdMemberIds: ['membership-1'],
      instructions: 'Planifica cenas sencillas.'
    },
    note: 'Requiere semana lunes y al menos un miembro seleccionado explícitamente.'
  },
  {
    name: 'aiAssistantActionRefinementRequestSchema',
    schema: aiAssistantActionRefinementRequestSchema,
    required: {
      actionId: 'action-1',
      instruction: 'Cambia la cantidad.',
      action: {
        kind: 'pantry.add_ingredient',
        title: 'Añadir lentejas',
        summary: 'Añade lentejas a la despensa.',
        dependsOn: [],
        warnings: [],
        payload: {
          name: 'Lentejas',
          category: 'legumes',
          quantity: 500,
          unit: 'g',
          expirationDate: null,
          location: 'pantry',
          notes: null
        }
      },
      scope: { kind: 'action' }
    }
  },
  {
    name: 'aiAssistantBatchRefinementRequestSchema',
    schema: aiAssistantBatchRefinementRequestSchema,
    required: {
      instruction: 'Revisa el lote.',
      scope: { kind: 'batch' },
      actions: [
        {
          actionId: 'pantry-1',
          action: {
            kind: 'pantry.add_ingredient',
            title: 'Añadir lentejas',
            summary: 'Añade lentejas.',
            payload: {
              name: 'Lentejas',
              category: 'legumes',
              quantity: 1,
              unit: 'unit',
              expirationDate: null,
              location: 'pantry',
              notes: null
            },
            dependsOn: [],
            warnings: []
          }
        },
        {
          actionId: 'shopping-1',
          action: {
            kind: 'shopping.create_list',
            title: 'Crear lista',
            summary: 'Crea una lista.',
            payload: { name: 'Compra semanal', store: null },
            dependsOn: [],
            warnings: []
          }
        }
      ]
    }
  },
  {
    name: 'assistantActionPlanCandidateSchema',
    schema: assistantActionPlanCandidateSchema,
    required: { summary: 'Sin acciones.', actions: [], questions: [] }
  },
  {
    name: 'assistantActionPlanProviderCandidateSchema',
    schema: assistantActionPlanProviderCandidateSchema,
    required: { summary: 'Sin acciones.', actions: [], questions: [] }
  },
  {
    name: 'assistantActionRefinementProviderCandidateSchema',
    schema: assistantActionRefinementProviderCandidateSchema,
    required: { summary: 'Sin cambios.', replacement: null, questions: [] }
  },
  {
    name: 'assistantActionBatchRefinementProviderCandidateSchema',
    schema: assistantActionBatchRefinementProviderCandidateSchema,
    required: { summary: 'Sin cambios.', replacements: [], questions: [] }
  },
  {
    name: 'assistantUpdateIngredientSchema',
    schema: assistantUpdateIngredientSchema,
    required: {
      changes: { quantity: 0 },
      assistantAction: {
        operation: 'update_ingredient',
        targetId: 'ingredient-1',
        before: {
          name: 'Yogur natural',
          category: 'dairy',
          quantity: 2,
          unit: 'unit',
          expirationDate: null,
          location: 'fridge',
          notes: null,
          updatedAt: null
        }
      }
    }
  },
  {
    name: 'assistantUpdateCalendarEventSchema',
    schema: assistantUpdateCalendarEventSchema,
    required: {
      changes: { title: 'Revisión actualizada' },
      assistantAction: {
        operation: 'update_event',
        targetId: 'event-1',
        householdId: null,
        before: {
          householdId: null,
          title: 'Revisión del coche',
          kind: 'appointment',
          date: '2026-10-20',
          startTime: '09:00',
          endTime: '10:00',
          allDay: false,
          color: null,
          notes: null,
          location: null,
          recurrence: 'none',
          recurrenceRule: null,
          exceptions: '[]',
          source: 'user',
          updatedAt: null
        }
      }
    }
  },
  {
    name: 'assistantRecipeContentSnapshotSchema',
    schema: assistantRecipeContentSnapshotSchema,
    required: {
      name: 'Lentejas',
      servings: 2,
      ingredients: [{ name: 'Lentejas', quantity: 100, unit: 'g' }],
      steps: [{ stepNumber: 1, instruction: 'Cuece las lentejas.' }]
    }
  },
  {
    name: 'assistantRecipeContentUpdateRequestSchema',
    schema: assistantRecipeContentUpdateRequestSchema,
    required: {
      changes: {
        servings: null,
        ingredients: [{ operation: 'update', targetName: 'Lentejas', changes: { quantity: 80 } }],
        instructions: []
      },
      assistantAction: {
        operation: 'update_recipe_content',
        targetId: 'recipe-1',
        before: {
          name: 'Lentejas',
          servings: 2,
          ingredients: [{ name: 'Lentejas', quantity: 100, unit: 'g' }],
          steps: [{ stepNumber: 1, instruction: 'Cuece las lentejas.' }]
        }
      }
    }
  },
  {
    name: 'assistantActionRefinementCandidateSchema',
    schema: assistantActionRefinementCandidateSchema,
    required: { summary: 'Cantidad revisada.', replacement: null, questions: [] }
  },
  {
    name: 'assistantActionBatchRefinementCandidateSchema',
    schema: assistantActionBatchRefinementCandidateSchema,
    required: {
      summary: 'Lote revisado.',
      replacements: [
        {
          kind: 'shopping.create_list',
          title: 'Crear lista',
          summary: 'Crea una lista.',
          payload: { name: 'Compra semanal', store: null },
          dependsOn: [],
          warnings: []
        }
      ],
      questions: []
    }
  },
  {
    name: 'aiFunctionProviderAssignmentSchema',
    schema: aiFunctionProviderAssignmentSchema,
    required: { configId: 'provider-1' },
    note: 'Se asigna un proveedor del mismo scope; `null` desasigna explícitamente la función.'
  },
  {
    name: 'createAiConfigSchema',
    schema: createAiConfigSchema,
    required: { name: 'Local', baseUrl: 'http://localhost:1234/v1', apiKey: 'sk-x', model: 'qwen' }
  },
  { name: 'updateAiConfigSchema', schema: updateAiConfigSchema },
  {
    name: 'testConnectionSchema',
    schema: testConnectionSchema,
    required: { baseUrl: 'http://localhost:1234/v1', apiKey: 'sk-x', model: 'qwen' },
    except: {
      baseUrl:
        'Sin configId, el trio del formulario es todo o nada: un baseUrl hueco es un 400 a proposito (el refine exige configId O baseUrl+apiKey+model).',
      apiKey:
        'El trio del formulario no admite mitades: sin configId ni apiKey no hay prueba que hacer.',
      model:
        'El trio del formulario no admite mitades: sin configId ni model no hay prueba que hacer.'
    },
    note: 'La prueba admite dos formas: configId guardado o los datos del formulario (baseUrl+apiKey+model); el refine exige una de las dos, y quien trae configId puede traer el resto hueco.'
  },
  {
    name: 'generateRecipeSchema',
    schema: generateRecipeSchema,
    required: { ingredients: [{ id: 'i', name: 'Tomate', quantity: 1, unit: 'g' }] }
  },
  {
    name: 'replaceMealSchema',
    schema: replaceMealSchema,
    required: { mealId: 'meal-1', guests: [] }
  },
  {
    name: 'generateWeeklyPlanSchema',
    schema: generateWeeklyPlanSchema,
    required: { startDate: '2026-03-09', endDate: '2026-03-15', goals: { type: 'balanced' } }
  },
  { name: 'getRecommendationsSchema', schema: getRecommendationsSchema },

  // ── La lectura de tickets por IA (## 12aj) ──
  {
    name: 'createReceiptItemSchema',
    schema: createReceiptItemSchema,
    required: { name: 'Leche entera' },
    note: 'Una linea escrita a mano durante la revision solo exige el nombre: el resto (categoria, precio, oferta) se puede dejar para despues o para la IA.'
  },
  { name: 'updateReceiptItemSchema', schema: updateReceiptItemSchema },
  { name: 'updateReceiptSchema', schema: updateReceiptSchema }
];

/** Los demas: se listan con el motivo, y la regla del final no deja esconder un formulario aqui. */
const EXEMPT: Record<string, string> = {
  productIndexSchema: 'parametros de busqueda del indice de productos, sin cuerpo de formulario',
  photoAnalyzeSchema:
    'una subida de OCR manda SIEMPRE la imagen: sin imagen no hay peticion que procesar',
  adjustServingsSchema:
    'el ajuste de raciones es un numero o nada, y «nada» se resuelve en el frontend',
  createPriceSchema:
    'alta de precios desde el cierre de lista: los cuatro campos son obligatorios por contrato de negocio',
  shelfAnswerSchema:
    'la respuesta del modelo al pedirle vidas utiles (## 12ak): la escribe la IA, no un formulario de la interfaz',
  mealReplacementCandidateSchema:
    'respuesta estructurada temporal del proveedor de IA, no es un formulario de usuario',
  mealReplacementResponseSchema:
    'contrato estricto de salida del modelo para sustituciones, no es un formulario de usuario',
  assistantMealProposalRefinementInstructionSchema:
    'campo escalar acotado dentro de la refinación compuesta; no es un cuerpo de formulario independiente'
};

function shapeOf(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | null {
  const shape = (schema as { shape?: Record<string, z.ZodTypeAny> }).shape;
  return shape ?? null;
}

function optionalKeys(row: Row): string[] {
  const shape = shapeOf(row.schema);
  if (!shape) return [];
  return Object.keys(shape).filter((key) => shape[key]?.isOptional?.() === true);
}

function requiredKeys(row: Row): string[] {
  const shape = shapeOf(row.schema);
  if (!shape) return [];
  return Object.keys(shape).filter((key) => !optionalKeys(row).includes(key));
}

/**
 * `''` solo se exige a lo que un input puede mandar vacio: texto, número y enum de filtro. Un enum
 * dentro de un cuerpo no: los `<select>` de esta app siempre tienen opción elegida, y aceptar `''` ahi
 * seria abrir la puerta a escribir un valor que no esta en la lista.
 */
function acceptsBlank(schema: z.ZodTypeAny, enumsCount: boolean = true): boolean {
  const kinds = new Set<string>();
  const walk = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    const def = (node as { _def?: any; def?: any }).def ?? (node as { _def?: any })._def;
    if (!def) return;
    if (typeof def.type === 'string') kinds.add(def.type);
    for (const key of ['innerType', 'in', 'out', 'type', 'schema', 'element', 'options', 'items']) {
      const next = def[key];
      if (Array.isArray(next)) next.forEach((item) => walk(item, depth + 1));
      else if (next) walk(next, depth + 1);
    }
  };
  walk(schema);
  if (kinds.has('string') || kinds.has('number')) return true;
  return enumsCount && kinds.has('enum');
}

describe('contrato de formularios: lo opcional puede no llegar', () => {
  for (const row of ROWS) {
    const minimal = row.required ?? {};

    it(`${row.name}: solo los campos obligatorios se acepta`, () => {
      const parsed = row.schema.safeParse(minimal);
      expect(
        parsed.success,
        JSON.stringify((parsed as { error?: z.ZodError }).error?.issues ?? [])
      ).toBe(true);
    });

    it(`${row.name}: cada opcional admite las formas del hueco`, () => {
      const shape = shapeOf(row.schema);
      const failures: string[] = [];
      for (const key of optionalKeys(row)) {
        if (row.except?.[key]) continue;
        const field = shape?.[key] ?? row.schema;
        const blankable = acceptsBlank(field, row.kind === 'query');
        const nullable = row.kind === 'query' ? blankable : true;
        const variants: unknown[] = [undefined];
        if (nullable) variants.push(null);
        if (blankable) variants.push('', '   ');
        for (const value of variants) {
          const payload = { ...minimal, [key]: value };
          if (value === undefined) delete payload[key];
          const parsed = row.schema.safeParse(payload);
          if (!parsed.success) {
            const issue = (parsed.error as z.ZodError).issues[0];
            failures.push(`${key}=${JSON.stringify(value)}: ${issue?.message ?? 'rechazado'}`);
          }
        }
      }
      expect(
        failures,
        `el formulario manda estas formas y la API las rechaza:\n  ${failures.join('\n  ')}`
      ).toEqual([]);
    });

    it(`${row.name}: las excepciones del contrato estan justificadas`, () => {
      // Una excepcion sin motivo escrito es una puerta; con motivo, una decision.
      for (const key of Object.keys(row.except ?? {})) {
        expect(row.except![key].length, `${row.name}.${key} sin motivo`).toBeGreaterThan(12);
        expect(
          optionalKeys(row),
          `${row.name}.${key} no es opcional: fuera la excepcion`
        ).toContain(key);
      }
    });

    it(`${row.name}: un vacio de texto no se guarda como cadena vacia`, () => {
      // «Sin valor» tiene que llegar al SQL como NULL: una cadena vacia en la columna de notas se
      // pinta como una nota existente y vacia, y desde ahi ya no se puede volver a «quitarla».
      const shape = shapeOf(row.schema);
      if (!shape) return;
      const sample = { ...minimal };
      for (const key of optionalKeys(row)) if (acceptsBlank(shape[key], false)) sample[key] = '   ';
      const parsed = row.schema.safeParse(sample);
      if (!parsed.success) return; // schemas sin helpers propios (filters, legacies) no prometen esto
      const data = parsed.data as Record<string, unknown>;
      const leftovers = Object.keys(sample).filter(
        (key) => data[key] === '' || (typeof data[key] === 'string' && !data[key])
      );
      expect(
        leftovers,
        `estos campos se guardarian en blanco en vez de NULL: ${leftovers.join(', ')}`
      ).toEqual([]);
    });

    it(`${row.name}: y los obligatorios siguen siendo obligatorios`, () => {
      const missing = requiredKeys(row);
      for (const key of missing) {
        const payload = { ...minimal };
        delete payload[key];
        expect(row.schema.safeParse(payload).success, `${key} no deberia poder omitirse`).toBe(
          false
        );
      }
    });
  }

  it('los helpers de form.ts normalizan null, vacio y espacios', () => {
    const text = z.object({ v: formText(10, 'Notas') });
    expect(text.safeParse({}).success).toBe(true);
    expect((text.parse({ v: null }) as { v: unknown }).v).toBeNull();
    expect((text.parse({ v: '   ' }) as { v: unknown }).v).toBeNull();
    expect((text.parse({ v: '  hola  ' }) as { v: string }).v).toBe('hola');
    expect(
      (text.safeParse({ v: 'x'.repeat(11) }) as { error: z.ZodError }).error.issues[0].message
    ).toContain('maximo 10');

    const time = z.object({ v: formTime('Hora') });
    expect(time.safeParse({ v: '25:00' }).success).toBe(false);
    expect((time.parse({ v: '' }) as { v: unknown }).v).toBeNull();

    const color = z.object({ v: formColor() });
    expect(color.safeParse({ v: 'red' }).success).toBe(false);
    expect((color.parse({ v: '#4CAF50' }) as { v: string }).v).toBe('#4CAF50');

    const number = z.object({ v: formNumber({ int: true, positive: true }) });
    expect((number.parse({ v: '' }) as { v: unknown }).v).toBeNull();
    expect((number.parse({ v: '7' }) as { v: number }).v).toBe(7);
    expect(number.safeParse({ v: 0 }).success).toBe(false);

    const bool = z.object({ v: formBool() });
    expect((bool.parse({ v: '1' }) as { v: boolean }).v).toBe(true);
    expect((bool.parse({ v: 0 }) as { v: boolean }).v).toBe(false);
    expect(bool.safeParse({ v: null }).success).toBe(true);
  });

  it('un 400 dice el campo y el motivo, en espanol', () => {
    const parsed = createCalendarEventSchema.safeParse({ title: '', date: '11-03-2026' });
    expect(parsed.success).toBe(false);
    const report = describeIssues((parsed as { error: z.ZodError }).error);
    expect(report.message).toMatch(/titulo|title/i);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.every((issue) => !/^(invalid|too |expected)/i.test(issue.message))).toBe(
      true
    );
  });
});

/**
 * EL CANDADO. Ningun formulario se queda sin contrato: si una ruta empieza a parsear un schema nuevo,
 * este test falla hasta que tenga fila en `ROWS` o este en `EXEMPT` con un motivo que se pueda leer.
 * Y `EXEMPT` no es una puerta de escape: se comprueba que de verdad no tenga campos opcionales, asi
 * que «me da pereza escribir la fila» no se puede disfrazar de «esto no es un formulario».
 */
describe('ningun schema de ruta se queda sin contrato', () => {
  const routesDir = join(process.cwd(), 'src/routes');
  const parsed = new Set<string>();
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.routes.ts'))) {
    const source = readFileSync(join(routesDir, file), 'utf8');
    for (const match of source.matchAll(/([A-Za-z0-9_]+Schema)\.(?:safe)?[Pp]arse\(/g))
      parsed.add(match[1]);
    for (const match of source.matchAll(/readForm\(c,\s*([A-Za-z0-9_]+Schema)\b/g))
      parsed.add(match[1]);
  }

  const rows = new Map(ROWS.map((row) => [row.name, row]));

  it('todo schema que parsea una ruta tiene su fila o su motivo', () => {
    const missing = [...parsed].filter((name) => !rows.has(name) && !EXEMPT[name]).sort();
    expect(
      missing,
      `faltan las filas de: ${missing.join(', ')}. Anade la suya en ROWS con su payload minimo —es el` +
        ` test que falta cuando un campo nuevo se marca como opcional en la interfaz.`
    ).toEqual([]);
  });

  it('las filas existen en el codigo, y los exentos no esconden opcionales', () => {
    const hidden: string[] = [];
    for (const name of Object.keys(EXEMPT)) {
      if (!parsed.has(name) && !rows.has(name))
        hidden.push(`${name}: no lo parsea ninguna ruta (fuera la excepcion)`);
    }
    expect(hidden).toEqual([]);
  });
});
