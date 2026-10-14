import { describe, expect, it } from 'vitest';
import {
  createMealPlanningContextFilePart,
  HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME,
  type MealPlanningContextAttachmentInput,
  type SerializedMealPlanningContext
} from './household-meal-planning-context-attachment.js';

describe('createMealPlanningContextFilePart', () => {
  it('encodes the complete versioned context as one JSON file message part', () => {
    const context: MealPlanningContextAttachmentInput = {
      targetWeek: { startDate: '2026-10-12', endDate: '2026-10-18' },
      household: {
        objective: { goals: ['balanced'], notes: 'Objetivo común' },
        schedule: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: true },
          mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
        }
      },
      participants: [
        {
          alias: 'P1',
          preferences: {
            strictAllergies: ['cacahuete'],
            likes: ['lentejas'],
            dislikes: ['pimiento']
          },
          effectiveObjective: { source: 'member', goals: ['weight-loss'], notes: 'Nota efectiva' },
          effectiveSchedule: {
            source: 'household',
            mealTypes: { breakfast: false, lunch: true, snack: false, dinner: true },
            mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
          }
        }
      ],
      requiredTurns: [
        {
          date: '2026-10-12',
          mealType: 'lunch',
          time: '14:00',
          eligibleParticipants: ['P1']
        }
      ],
      pantry: [{ name: 'Lentejas', quantity: 400, unit: 'g', expirationDate: '2026-12-01' }],
      utensils: [{ name: 'Olla a presión', category: 'cocción' }],
      recipes: [
        {
          name: 'Lentejas guisadas',
          description: 'Guiso sencillo',
          ingredients: [{ name: 'lentejas', quantity: 80, unit: 'g' }]
        }
      ],
      previousConfirmedPlan: {
        weekStart: '2026-10-05',
        weekEnd: '2026-10-11',
        events: [
          {
            date: '2026-10-05',
            mealType: 'dinner',
            time: '20:30',
            servings: 2,
            participants: ['P1', 'P2'],
            recipe: {
              name: 'Sopa de verduras',
              description: 'Sopa casera',
              ingredients: [{ name: 'zanahoria', quantity: 2, unit: 'ud' }]
            }
          }
        ]
      }
    };

    const part = createMealPlanningContextFilePart(context);

    expect(part.type).toBe('file');
    expect(part.file.filename).toBe(HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME);
    expect(part.file.filename).toBe('meal-planning-context.json');
    expect(part.file.file_data.startsWith('data:application/json;base64,')).toBe(true);

    const encodedJson = part.file.file_data.slice('data:application/json;base64,'.length);
    const decodedContext = JSON.parse(
      Buffer.from(encodedJson, 'base64').toString('utf8')
    ) as SerializedMealPlanningContext;
    expect(decodedContext).toEqual({ version: 1, ...context });
  });

  it('preserves a null household value and absent prior confirmed plan as JSON null', () => {
    const context: MealPlanningContextAttachmentInput = {
      targetWeek: { startDate: '2026-10-12', endDate: '2026-10-18' },
      household: { objective: null, schedule: null },
      participants: [],
      requiredTurns: [],
      pantry: [],
      utensils: [],
      recipes: [],
      previousConfirmedPlan: null
    };

    const part = createMealPlanningContextFilePart(context);
    const encodedJson = part.file.file_data.slice('data:application/json;base64,'.length);

    expect(JSON.parse(Buffer.from(encodedJson, 'base64').toString('utf8'))).toEqual({
      version: 1,
      ...context
    });
  });
});
