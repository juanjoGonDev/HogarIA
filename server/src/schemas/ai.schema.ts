import { z } from 'zod';
import { formDefault, formField, formPartial } from './form.js';
import { tasteGoalEnum } from '../utils/taste-profile.js';
import { AI_TIMEOUT_DEFAULT_MS, AI_TIMEOUT_MAX_MS } from '../utils/ai-timeout.js';

const aiProviderEnum = z.enum(['openai', 'custom']);
export const aiFunctionProviderAssignmentSchema = z
  .object({ configId: z.string().trim().min(1).nullable() })
  .strict();
const detailLevelEnum = z.enum(['basic', 'intermediate', 'expert']);
const guestPreferenceList = z.array(z.string().trim().min(1).max(60)).max(20).default([]);

export const guestPreferencesSchema = z
  .object({
    allergies: guestPreferenceList,
    intolerances: guestPreferenceList,
    diets: guestPreferenceList,
    likes: guestPreferenceList,
    dislikes: guestPreferenceList,
    notes: z.string().trim().max(300).default('')
  })
  .strict();

const householdMemberIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Household member selections must be unique');

const weeklyPlanGoalsSchema = z
  .object({
    /** Forma canónica; `type` sigue admitido como alias de compatibilidad. */
    types: z.array(tasteGoalEnum).max(7).optional(),
    type: tasteGoalEnum.optional(),
    caloriesTarget: formField(z.number().positive()),
    proteinTarget: formField(z.number().positive()),
    restrictions: formDefault(z.array(z.string()), []),
    customInstructions: formField(z.string().trim().max(2000))
  })
  .passthrough()
  .superRefine((goals, context) => {
    const types = goals.types ?? (goals.type ? [goals.type] : []);
    const customInstructions = goals.customInstructions?.trim() ?? '';
    if (types.length === 0 && !customInstructions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['types'],
        message: 'Selecciona al menos un objetivo o escribe uno personalizado'
      });
    }
    if (types.includes('custom') && !customInstructions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customInstructions'],
        message: 'Escribe el objetivo personalizado'
      });
    }
  })
  .transform((goals) => {
    const { type: _legacyType, ...rest } = goals;
    return {
      ...rest,
      types: [...new Set(goals.types ?? (goals.type ? [goals.type] : []))],
      customInstructions: goals.customInstructions?.trim() ?? ''
    };
  });

export const replaceMealSchema = z
  .object({
    mealId: z.string().trim().min(1).max(100),
    householdMemberIds: formField(householdMemberIdsSchema),
    goals: formField(weeklyPlanGoalsSchema),
    guests: formDefault(z.array(guestPreferencesSchema).max(8), [])
  })
  .strict();

export const mealReplacementCandidateSchema = z
  .object({
    safe: z.literal(true),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    ingredients: z.array(z.string().trim().min(1)).min(1).max(30),
    estimatedTime: z.number().int().positive().max(360),
    servings: z.number().int().positive()
  })
  .strict();

/** Forma estricta completa que se envía al proveedor, incluida la rama de rechazo. */
export const mealReplacementResponseSchema = z
  .object({
    safe: z.boolean(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    ingredients: z.array(z.string()).nullable(),
    estimatedTime: z.number().int().nullable(),
    servings: z.number().int().nullable()
  })
  .strict();
// No product cap: only Node's maximum safe timer range is enforced.
export const AI_CONFIG_MAX_TIMEOUT_MS = AI_TIMEOUT_MAX_MS;
export const AI_CONFIG_MAX_TOKENS = 4096;
export const AI_CONFIG_DEFAULT_MAX_TOKENS = AI_CONFIG_MAX_TOKENS;

// AI Config schemas
export const createAiConfigSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  provider: formDefault(aiProviderEnum, 'custom'),
  baseUrl: z.string().url('Invalid URL format'),
  apiKey: z
    .string()
    .min(1, 'API key is required')
    .refine((value) => Boolean(value.trim()), 'API key is required'),
  model: z.string().min(1, 'Model is required'),
  temperature: formDefault(z.number().min(0).max(2), 0.7),
  maxTokens: formDefault(
    z.number().int().positive().max(AI_CONFIG_MAX_TOKENS),
    AI_CONFIG_DEFAULT_MAX_TOKENS
  ),
  topP: formField(z.number().min(0).max(1)),
  frequencyPenalty: formField(z.number().min(-2).max(2)),
  presencePenalty: formField(z.number().min(-2).max(2)),
  timeout: formDefault(
    z.number().int().positive().max(AI_CONFIG_MAX_TIMEOUT_MS),
    AI_TIMEOUT_DEFAULT_MS
  ),
  retryAttempts: formDefault(z.number().int().min(0).max(5), 3),
  // Máximo de trabajo de IA en vuelo por proveedor: 0 elimina el límite configurado.
  concurrency: formDefault(z.number().int().min(0).max(8), 0)
});

export const updateAiConfigSchema = formPartial(createAiConfigSchema).extend({
  isActive: formField(z.boolean())
});

// Test connection schema
/**
 * La prueba de conexion (## 8f, revisada): va contra una config GUARDADA (`configId`, el boton
 * de su tarjeta) o contra los datos del formulario tal cual estan escritos (baseUrl + apiKey +
 * model), que es lo que permite «Probar conexion» ANTES de guardar. Una u otra: probar sin
 * nada en las manos no tiene sentido.
 */
export const testConnectionSchema = z
  .object({
    configId: formField(z.string()),
    baseUrl: formField(z.string().url()),
    apiKey: formField(z.string().min(1)),
    model: formField(z.string().min(1)),
    timeout: formField(z.number().int().positive().max(AI_CONFIG_MAX_TIMEOUT_MS))
  })
  .refine(
    (valor) => Boolean(valor.configId) || Boolean(valor.baseUrl && valor.apiKey && valor.model),
    { message: 'Hace falta un configId o baseUrl, apiKey y model' }
  );

// Recipe generation schema
export const generateRecipeSchema = z.object({
  ingredients: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        quantity: z.number(),
        unit: z.string()
      })
    )
    .min(1, 'At least one ingredient is required'),
  utensils: formDefault(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        available: z.boolean()
      })
    ),
    []
  ),
  servings: formDefault(z.number().int().positive(), 2),
  householdMemberIds: formField(householdMemberIdsSchema),
  guests: formDefault(z.array(guestPreferencesSchema).max(8), []),
  difficulty: formDefault(z.enum(['easy', 'medium', 'hard']), 'medium'),
  detailLevel: formDefault(detailLevelEnum, 'intermediate'),
  dietaryRestrictions: formDefault(z.array(z.string()), []),
  allergies: formDefault(z.array(z.string()), []),
  preferences: formDefault(z.array(z.string()), []),
  cookingTime: formField(
    z.object({
      min: z.number().int().positive(),
      max: z.number().int().positive()
    })
  ),
  generateMultiple: formDefault(z.boolean(), false),
  count: formDefault(z.number().int().min(1).max(5), 3)
});

// Weekly plan schema
export const generateWeeklyPlanSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    householdMemberIds: formField(householdMemberIdsSchema),
    guests: formDefault(z.array(guestPreferencesSchema).max(8), []),
    // El objeto `goals` exige al menos un objetivo tipado o instrucciones libres. Calorias/proteinas
    // son datos adicionales y sí pueden faltar.
    goals: weeklyPlanGoalsSchema,
    availableIngredients: formDefault(z.array(z.string()), []),
    /**
     * Que comidas se piden («Desayuno, almuerzo, cena»). `formDefault` con la lista vacia: la UI manda
     * lo que la persona ha marcado y el servicio resuelve vacio = el dia completo (ver
     * `resolveMealTypes`), asi que un «no he marcado nada» no puede ser ni un 400 ni un plan vacio.
     */
    mealTypes: formDefault(z.array(z.string().max(20)).max(12), [])
  })
  .strict();

// Recommendation schema
export const getRecommendationsSchema = z.object({
  recentMeals: formDefault(
    z.array(z.object({ date: z.string(), meal: z.string(), recipeId: formField(z.string()) })),
    []
  ),
  availableIngredients: formDefault(z.array(z.string()), []),
  householdPreferences: formField(
    z.object({
      likes: formDefault(z.array(z.string()), []),
      dislikes: formDefault(z.array(z.string()), []),
      allergies: formDefault(z.array(z.string()), [])
    })
  ),
  goals: formField(z.object({ type: z.string(), target: formField(z.number()) })),
  count: formDefault(z.number().int().min(1).max(10), 3)
});

export type CreateAiConfigInput = z.infer<typeof createAiConfigSchema>;
export type UpdateAiConfigInput = z.infer<typeof updateAiConfigSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;
export type GuestPreferences = z.infer<typeof guestPreferencesSchema>;
export type GenerateRecipeInput = z.infer<typeof generateRecipeSchema>;
export type ReplaceMealInput = z.infer<typeof replaceMealSchema>;
export type GenerateWeeklyPlanInput = z.infer<typeof generateWeeklyPlanSchema>;
export type GetRecommendationsInput = z.infer<typeof getRecommendationsSchema>;
