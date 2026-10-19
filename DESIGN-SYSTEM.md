# 🎨 Sistema de Diseño - HogarIA

## Filosofía de Diseño

**Minimalismo Funcional:** Cada elemento tiene un propósito. Eliminamos lo decorativo y nos enfocamos en la claridad, legibilidad y fluidez de la experiencia.

**Principios:**
1. **Menos es más** - Espacios generosos, tipografía limpia
2. **Jerarquía visual clara** - Guía al usuario sin esfuerzo
3. **Consistencia total** - Mismo comportamiento en todos los componentes
4. **Mobile-first** - Optimizado para interacción táctil
5. **Accesibilidad** - Contraste WCAG AA mínimo

---

## 🎨 Paleta de Colores

### Modo Claro (Default)

```scss
:root {
  // ═══════════════════════════════════════════════════════════
  // COLORES PRIMARIOS - Naranja Cálido (Appetite-stimulating)
  // ═══════════════════════════════════════════════════════════
  --color-primary-50: #FFF7ED;
  --color-primary-100: #FFEDD5;
  --color-primary-200: #FED7AA;
  --color-primary-300: #FDBA74;
  --color-primary-400: #FB923C;
  --color-primary-500: #F97316;  // Principal
  --color-primary-600: #EA580C;
  --color-primary-700: #C2410C;
  --color-primary-800: #9A3412;
  --color-primary-900: #7C2D12;
  
  // Alias de uso frecuente
  --primary: var(--color-primary-500);
  --primary-light: var(--color-primary-300);
  --primary-dark: var(--color-primary-700);
  --primary-subtle: var(--color-primary-50);
  
  // ═══════════════════════════════════════════════════════════
  // COLORES SECUNDARIOS - Verde Fresco (Health, Freshness)
  // ═══════════════════════════════════════════════════════════
  --color-secondary-50: #F0FDF4;
  --color-secondary-100: #DCFCE7;
  --color-secondary-200: #BBF7D0;
  --color-secondary-300: #86EFAC;
  --color-secondary-400: #4ADE80;
  --color-secondary-500: #22C55E;  // Principal
  --color-secondary-600: #16A34A;
  --color-secondary-700: #15803D;
  --color-secondary-800: #166534;
  --color-secondary-900: #14532D;
  
  --secondary: var(--color-secondary-500);
  --secondary-light: var(--color-secondary-300);
  --secondary-dark: var(--color-secondary-700);
  --secondary-subtle: var(--color-secondary-50);
  
  // ═══════════════════════════════════════════════════════════
  // NEUTROS - Grises Cálidos (Base del diseño)
  // ═══════════════════════════════════════════════════════════
  --color-neutral-0: #FFFFFF;
  --color-neutral-50: #FAFAF9;
  --color-neutral-100: #F5F5F4;
  --color-neutral-200: #E7E5E4;
  --color-neutral-300: #D6D3D1;
  --color-neutral-400: #A8A29E;
  --color-neutral-500: #78716C;
  --color-neutral-600: #57534E;
  --color-neutral-700: #44403C;
  --color-neutral-800: #292524;
  --color-neutral-900: #1C1917;
  --color-neutral-950: #0C0A09;
  
  // Alias de uso frecuente
  --white: var(--color-neutral-0);
  --black: var(--color-neutral-950);
  --bg-primary: var(--color-neutral-50);
  --bg-secondary: var(--color-neutral-0);
  --bg-tertiary: var(--color-neutral-100);
  --text-primary: var(--color-neutral-900);
  --text-secondary: var(--color-neutral-600);
  --text-tertiary: var(--color-neutral-400);
  --text-inverse: var(--color-neutral-0);
  --border-default: var(--color-neutral-200);
  --border-strong: var(--color-neutral-300);
  
  // ═══════════════════════════════════════════════════════════
  // COLORES SEMÁNTICOS
  // ═══════════════════════════════════════════════════════════
  
  // Success (Verde)
  --color-success-50: #F0FDF4;
  --color-success-100: #DCFCE7;
  --color-success-500: #22C55E;
  --color-success-600: #16A34A;
  --color-success-700: #15803D;
  --success: var(--color-success-500);
  --success-subtle: var(--color-success-50);
  
  // Warning (Ámbar)
  --color-warning-50: #FFFBEB;
  --color-warning-100: #FEF3C7;
  --color-warning-500: #F59E0B;
  --color-warning-600: #D97706;
  --color-warning-700: #B45309;
  --warning: var(--color-warning-500);
  --warning-subtle: var(--color-warning-50);
  
  // Error (Rojo)
  --color-error-50: #FEF2F2;
  --color-error-100: #FEE2E2;
  --color-error-500: #EF4444;
  --color-error-600: #DC2626;
  --color-error-700: #B91C1C;
  --error: var(--color-error-500);
  --error-subtle: var(--color-error-50);
  
  // Info (Azul)
  --color-info-50: #EFF6FF;
  --color-info-100: #DBEAFE;
  --color-info-500: #3B82F6;
  --color-info-600: #2563EB;
  --color-info-700: #1D4ED8;
  --info: var(--color-info-500);
  --info-subtle: var(--color-info-50);
}
```

### Modo Oscuro

```scss
[data-theme="dark"] {
  --bg-primary: var(--color-neutral-950);
  --bg-secondary: var(--color-neutral-900);
  --bg-tertiary: var(--color-neutral-800);
  --text-primary: var(--color-neutral-50);
  --text-secondary: var(--color-neutral-400);
  --text-tertiary: var(--color-neutral-500);
  --border-default: var(--color-neutral-700);
  --border-strong: var(--color-neutral-600);
  
  // Ajustar primarios para mejor legibilidad en oscuro
  --primary: var(--color-primary-400);
  --primary-light: var(--color-primary-300);
  --secondary: var(--color-secondary-400);
  --secondary-light: var(--color-secondary-300);
}
```

---

## 📐 Espaciado y Grid

### Sistema de Espaciado (4px base)

```scss
:root {
  --space-0: 0;
  --space-1: 0.25rem;   // 4px
  --space-2: 0.5rem;    // 8px
  --space-3: 0.75rem;   // 12px
  --space-4: 1rem;      // 16px
  --space-5: 1.25rem;   // 20px
  --space-6: 1.5rem;    // 24px
  --space-8: 2rem;      // 32px
  --space-10: 2.5rem;   // 40px
  --space-12: 3rem;     // 48px
  --space-16: 4rem;     // 64px
  --space-20: 5rem;     // 80px
  --space-24: 6rem;     // 96px
  
  // Contenedor
  --container-max: 1280px;
  --container-padding: var(--space-4);
  
  @media (min-width: 768px) {
    --container-padding: var(--space-6);
  }
  
  @media (min-width: 1024px) {
    --container-padding: var(--space-8);
  }
}
```

### Grid Responsivo

```scss
.grid {
  display: grid;
  gap: var(--space-4);
  
  // Mobile: 1 columna por defecto
  &--2 { grid-template-columns: 1fr; }
  &--3 { grid-template-columns: 1fr; }
  &--4 { grid-template-columns: 1fr; }
  
  // Tablet: 2 columnas
  @media (min-width: 768px) {
    &--2 { grid-template-columns: repeat(2, 1fr); }
    &--3 { grid-template-columns: repeat(2, 1fr); }
    &--4 { grid-template-columns: repeat(2, 1fr); }
  }
  
  // Desktop: columnas completas
  @media (min-width: 1024px) {
    &--3 { grid-template-columns: repeat(3, 1fr); }
    &--4 { grid-template-columns: repeat(4, 1fr); }
  }
}
```

---

## ✍️ Tipografía

### Fuentes

```scss
:root {
  // Fuentes principales
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-display: 'Plus Jakarta Sans', var(--font-sans);
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  // Tamaños de fuente (escala modular 1.25)
  --text-xs: 0.75rem;      // 12px
  --text-sm: 0.875rem;     // 14px
  --text-base: 1rem;       // 16px
  --text-lg: 1.125rem;     // 18px
  --text-xl: 1.25rem;      // 20px
  --text-2xl: 1.5rem;      // 24px
  --text-3xl: 1.875rem;    // 30px
  --text-4xl: 2.25rem;     // 36px
  --text-5xl: 3rem;        // 48px
  
  // Pesos de fuente
  --font-light: 300;
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  --font-extrabold: 800;
  
  // Altura de línea
  --leading-none: 1;
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;
  
  // Espaciado entre letras
  --tracking-tighter: -0.05em;
  --tracking-tight: -0.025em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
  --tracking-wider: 0.05em;
  --tracking-widest: 0.1em;
}
```

### Escala Tipográfica

```scss
// Estilos predefinidos
.text-display {
  font-family: var(--font-display);
  font-size: var(--text-5xl);
  font-weight: var(--font-extrabold);
  line-height: var(--leading-none);
  letter-spacing: var(--tracking-tighter);
  color: var(--text-primary);
}

.text-heading-1 {
  font-family: var(--font-display);
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}

.text-heading-2 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-tight);
  color: var(--text-primary);
}

.text-heading-3 {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
  color: var(--text-primary);
}

.text-body-large {
  font-family: var(--font-sans);
  font-size: var(--text-lg);
  font-weight: var(--font-normal);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
}

.text-body {
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
  color: var(--text-secondary);
}

.text-body-small {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
  color: var(--text-tertiary);
}

.text-caption {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-normal);
  letter-spacing: var(--tracking-wide);
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.text-code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
  color: var(--primary);
  background: var(--primary-subtle);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
}
```

---

## 🔘 Bordes y Radios

```scss
:root {
  // Border Radius
  --radius-none: 0;
  --radius-sm: 0.25rem;    // 4px
  --radius-md: 0.5rem;     // 8px
  --radius-lg: 0.75rem;    // 12px
  --radius-xl: 1rem;       // 16px
  --radius-2xl: 1.5rem;    // 24px
  --radius-full: 9999px;   // Completo (píldora)
  
  // Bordes
  --border-width-1: 1px;
  --border-width-2: 2px;
  --border-width-4: 4px;
  
  // Borders predefinidos
  --border-default: var(--border-width-1) solid var(--border-default);
  --border-strong: var(--border-width-1) solid var(--border-strong);
  --border-primary: var(--border-width-2) solid var(--primary);
}
```

---

## 🌑 Sombras

```scss
:root {
  // Sombras sutiles (estilo Apple)
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  
  // Sombras de colores
  --shadow-primary: 0 4px 14px 0 rgb(249 115 22 / 0.25);
  --shadow-secondary: 0 4px 14px 0 rgb(34 197 94 / 0.25);
  --shadow-error: 0 4px 14px 0 rgb(239 68 68 / 0.25);
  
  // Sombras internas
  --shadow-inner: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);
  --shadow-inner-lg: inset 0 4px 8px 0 rgb(0 0 0 / 0.1);
}
```

---

## ✨ Transiciones y Animaciones

```scss
:root {
  // Duración
  --duration-75: 75ms;
  --duration-100: 100ms;
  --duration-150: 150ms;
  --duration-200: 200ms;
  --duration-300: 300ms;
  --duration-500: 500ms;
  --duration-700: 700ms;
  --duration-1000: 1000ms;
  
  // Easing
  --ease-linear: linear;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  
  // Transiciones predefinidas
  --transition-fast: all var(--duration-150) var(--ease-out);
  --transition-normal: all var(--duration-200) var(--ease-out);
  --transition-slow: all var(--duration-300) var(--ease-out);
  --transition-bounce: all var(--duration-300) var(--ease-bounce);
}

// Animaciones clave
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeInUp {
  from { 
    opacity: 0; 
    transform: translateY(10px); 
  }
  to { 
    opacity: 1; 
    transform: translateY(0); 
  }
}

@keyframes fadeInDown {
  from { 
    opacity: 0; 
    transform: translateY(-10px); 
  }
  to { 
    opacity: 1; 
    transform: translateY(0); 
  }
}

@keyframes slideInRight {
  from { 
    opacity: 0; 
    transform: translateX(20px); 
  }
  to { 
    opacity: 1; 
    transform: translateX(0); 
  }
}

@keyframes scaleIn {
  from { 
    opacity: 0; 
    transform: scale(0.95); 
  }
  to { 
    opacity: 1; 
    transform: scale(1); 
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

// Clases de animación
.animate-fade-in { animation: fadeIn var(--duration-200) var(--ease-out); }
.animate-fade-in-up { animation: fadeInUp var(--duration-300) var(--ease-out); }
.animate-fade-in-down { animation: fadeInDown var(--duration-300) var(--ease-out); }
.animate-slide-in-right { animation: slideInRight var(--duration-300) var(--ease-out); }
.animate-scale-in { animation: scaleIn var(--duration-200) var(--ease-out); }
.animate-pulse { animation: pulse 2s var(--ease-in-out) infinite; }
.animate-spin { animation: spin 1s linear infinite; }
```

---

## 🧩 Componentes Base

### Botones

```scss
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  line-height: var(--leading-none);
  border: var(--border-width-1) solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: var(--transition-fast);
  user-select: none;
  white-space: nowrap;
  
  &:focus-visible {
    outline: var(--border-width-2) solid var(--primary);
    outline-offset: var(--border-width-2);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  // Tamaños
  &--sm {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    border-radius: var(--radius-md);
  }
  
  &--lg {
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-base);
    border-radius: var(--radius-xl);
  }
  
  &--icon {
    padding: var(--space-2);
    aspect-ratio: 1;
  }
  
  // Variantes
  &--primary {
    background: var(--primary);
    color: var(--white);
    box-shadow: var(--shadow-sm);
    
    &:hover:not(:disabled) {
      background: var(--primary-dark);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
    
    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: var(--shadow-sm);
    }
  }
  
  &--secondary {
    background: var(--secondary);
    color: var(--white);
    box-shadow: var(--shadow-sm);
    
    &:hover:not(:disabled) {
      background: var(--secondary-dark);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }
  }
  
  &--outline {
    background: transparent;
    color: var(--text-primary);
    border-color: var(--border-default);
    
    &:hover:not(:disabled) {
      background: var(--bg-tertiary);
      border-color: var(--border-strong);
    }
  }
  
  &--ghost {
    background: transparent;
    color: var(--text-secondary);
    
    &:hover:not(:disabled) {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }
  }
  
  &--danger {
    background: var(--error);
    color: var(--white);
    
    &:hover:not(:disabled) {
      background: var(--color-error-700);
    }
  }
  
  // Loading state
  &--loading {
    position: relative;
    color: transparent;
    
    &::after {
      content: '';
      position: absolute;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: var(--radius-full);
      animation: spin 0.6s linear infinite;
      color: var(--white);
    }
  }
}
```

#### Estados de interacción: no son un detalle, son la asequibilidad

Un control que no cambia cuando el cursor pasa por encima no se distingue de un texto, y eso no lo decide
el gusto de nadie: lo decide que el ratón ya está ahí. Los tres estados de la tabla son obligatorios en
toda la app y los vigila `node scripts/check-ui.mjs` (regla `boton-sin-afecto`):

| Estado | Qué se escribe | Para qué |
| --- | --- | --- |
| `:hover` | `background`, `border-color` o `color` —una o dos, nunca un `transform` suelto— | «esto se puede pulsar», antes de pulsarlo |
| `:focus-visible` | lo pone el anillo global de `styles.scss`; solo se declara si el control lo personaliza | teclado sin ratón |
| `:disabled` | la opacidad la pone el componente; `cursor: not-allowed` lo pone el global | «aquí no, y hay una razón» |

Tres notas que salen de haberlo hecho mal:

- **El hover no se pone en los deshabilitados.** Un botón apagado que se ilumina al pasar por encima enseña
  en dos segundos a desconfiar de la pantalla entera. Se escribe `:hover:not(:disabled)`.
- **Los `<a>` no necesitan regla propia** —`styles.scss` ya la pone—, pero los `<button>` con clase sí: el
  reset global (`border: none; background: none`) existe para que `app-button` se pinte solo, y arrastra el
  efecto de que un botón con una clase tímida se vea como texto. El botón *sin* clase recibe un skin global
  (`button:not([class])`), así que lo que queda sin respuesta es siempre una decisión del CSS de la pantalla.
- **Un `label` con su `input` dentro es un control**, y el cursor lo dice: `label:has(input)` ya pone
  `pointer` en el global. No se repite por componente.

Y la parte que no es de CSS: si algo se pulsa, tiene que parecer pulsable. Un icono suelto sin `padding` y
sin `border-radius` es decoración, aunque tenga `cursor: pointer`.

### Inputs

```scss
.input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: var(--border-width-1) solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: var(--transition-fast);
  
  &::placeholder {
    color: var(--text-tertiary);
  }
  
  &:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  
  &:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--primary-subtle);
  }
  
  &--error {
    border-color: var(--error);
    
    &:focus {
      box-shadow: 0 0 0 3px var(--error-subtle);
    }
  }
  
  &--success {
    border-color: var(--success);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: var(--bg-tertiary);
  }
  
  // Tamaños
  &--sm {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
  }
  
  &--lg {
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-lg);
  }
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  
  &__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-primary);
  }
  
  &__helper {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  
  &__error {
    font-size: var(--text-xs);
    color: var(--error);
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
}
```

#### Vaciar un campo no es dejarlo «en blanco»

Dos cosas se parecen en la pantalla y no se parecen en el modelo: **no hay valor** y **usa el valor de
siempre**. La segunda no se describe por su aspecto —«en blanco: 09:00» no dice lo que hace el campo—, sino
por un botón que la ejecuta: **«Por defecto»**.

- En la API, `null` en el `PATCH` significa borrar la preferencia (vuelve el valor de fábrica) y la clave
  ausente significa no tocarla. Clave a clave, además: cambiar la cena no borra el desayuno.
- El campo del formulario se pinta siempre con un valor resuelto, nunca con un hueco: si no hay nada
  guardado se ve `09:00`, y ese es el valor que se guarda si no se toca.
- «Por defecto» solo aparece en la fila que se ha tocado. En la que ya vale lo de siempre no hay nada que
  deshacer, y un botón que no hace nada es ruido —ver `app-meal-hours`, que es el mismo control en el tour y
  en Preferencias.

`check-ui` (regla `texto-sin-en-blanco`) no deja escribir «en blanco» en una cadena visible: un comentario
de código puede hablar del lienzo; una pantalla, no.

### Cards

```scss
.card {
  background: var(--bg-secondary);
  border: var(--border-width-1) solid var(--border-default);
  border-radius: var(--radius-xl);
  overflow: hidden;
  transition: var(--transition-normal);
  
  &:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
  }
  
  &__header {
    padding: var(--space-4) var(--space-4) 0;
  }
  
  &__image {
    width: 100%;
    aspect-ratio: 16/9;
    object-fit: cover;
    background: var(--bg-tertiary);
  }
  
  &__content {
    padding: var(--space-4);
  }
  
  &__title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
    margin-bottom: var(--space-1);
  }
  
  &__description {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: var(--leading-relaxed);
  }
  
  &__footer {
    padding: 0 var(--space-4) var(--space-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  &__meta {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  
  // Variantes
  &--flat {
    box-shadow: none;
    border: none;
    background: var(--bg-tertiary);
    
    &:hover {
      background: var(--border-default);
      transform: none;
      box-shadow: none;
    }
  }
  
  &--interactive {
    cursor: pointer;
    
    &:active {
      transform: translateY(0);
    }
  }
  
  &--selected {
    border-color: var(--primary);
    box-shadow: 0 0 0 2px var(--primary-subtle);
  }
}
```

### Badges y Tags

```scss
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-none);
  border-radius: var(--radius-full);
  
  &--primary {
    background: var(--primary-subtle);
    color: var(--primary-dark);
  }
  
  &--secondary {
    background: var(--secondary-subtle);
    color: var(--secondary-dark);
  }
  
  &--success {
    background: var(--success-subtle);
    color: var(--color-success-700);
  }
  
  &--warning {
    background: var(--warning-subtle);
    color: var(--color-warning-700);
  }
  
  &--error {
    background: var(--error-subtle);
    color: var(--color-error-700);
  }
  
  &--neutral {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }
  
  // Tamaño
  &--sm {
    padding: 2px var(--space-1);
    font-size: 10px;
  }
  
  &--lg {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }
  
  // Con dot indicator
  &--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: currentColor;
  }
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: var(--border-width-1) solid var(--border-default);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-fast);
  
  &:hover {
    background: var(--border-default);
  }
  
  &--selected {
    background: var(--primary-subtle);
    border-color: var(--primary);
    color: var(--primary-dark);
  }
  
  &__remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: var(--border-default);
    color: var(--text-tertiary);
    font-size: 10px;
    cursor: pointer;
    transition: var(--transition-fast);
    
    &:hover {
      background: var(--error-subtle);
      color: var(--error);
    }
  }
}
```

### Timer Component

```scss
.timer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--bg-secondary);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-lg);
  
  &__display {
    font-family: var(--font-mono);
    font-size: var(--text-5xl);
    font-weight: var(--font-bold);
    color: var(--text-primary);
    letter-spacing: var(--tracking-wide);
  }
  
  &__label {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-align: center;
  }
  
  &__progress {
    width: 100%;
    height: 4px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  
  &__progress-bar {
    height: 100%;
    background: var(--primary);
    border-radius: var(--radius-full);
    transition: width 1s linear;
  }
  
  &__controls {
    display: flex;
    gap: var(--space-3);
  }
  
  // Estados
  &--running {
    .timer__display {
      color: var(--primary);
    }
  }
  
  &--paused {
    .timer__display {
      color: var(--warning);
    }
  }
  
  &--finished {
    .timer__display {
      color: var(--success);
      animation: pulse 1s infinite;
    }
  }
}
```

---

## 📱 Componentes de Receta

### Recipe Card

```scss
.recipe-card {
  @extend .card;
  
  &__difficulty {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
  }
  
  &__time {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    
    svg {
      width: 16px;
      height: 16px;
    }
  }
  
  &__servings {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  
  &__rating {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-warning-500);
  }
  
  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  
  &__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
}
```

### Ingredient Item

```scss
.ingredient-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--bg-secondary);
  border: var(--border-width-1) solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: var(--transition-fast);
  
  &:hover {
    border-color: var(--border-strong);
  }
  
  &__checkbox {
    width: 20px;
    height: 20px;
    border: var(--border-width-2) solid var(--border-strong);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-fast);
    
    &--checked {
      background: var(--primary);
      border-color: var(--primary);
      
      &::after {
        content: '✓';
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        color: var(--white);
        font-size: 12px;
      }
    }
  }
  
  &__info {
    flex: 1;
  }
  
  &__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text-primary);
  }
  
  &__quantity {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  
  &__expiration {
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    
    &--warning {
      background: var(--warning-subtle);
      color: var(--color-warning-700);
    }
    
    &--expired {
      background: var(--error-subtle);
      color: var(--color-error-700);
    }
    
    &--fresh {
      background: var(--success-subtle);
      color: var(--color-success-700);
    }
  }
  
  &__actions {
    display: flex;
    gap: var(--space-1);
    opacity: 0;
    transition: var(--transition-fast);
  }
  
  &:hover &__actions {
    opacity: 1;
  }
}
```

---

## 📐 Layout Patterns

### Mobile Navigation

```scss
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: space-around;
  height: 64px;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-secondary);
  border-top: var(--border-width-1) solid var(--border-default);
  backdrop-filter: blur(12px);
  
  &__item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2);
    color: var(--text-tertiary);
    text-decoration: none;
    transition: var(--transition-fast);
    cursor: pointer;
    
    &--active {
      color: var(--primary);
    }
    
    &:hover {
      color: var(--text-primary);
    }
    
    svg {
      width: 24px;
      height: 24px;
    }
  }
  
  &__label {
    font-size: 10px;
    font-weight: var(--font-medium);
  }
  
  &__badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    background: var(--error);
    border-radius: var(--radius-full);
  }
}
```

### Sidebar (Desktop)

```scss
.sidebar {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 280px;
  background: var(--bg-secondary);
  border-right: var(--border-width-1) solid var(--border-default);
  display: flex;
  flex-direction: column;
  z-index: 900;
  transform: translateX(-100%);
  transition: transform var(--duration-300) var(--ease-out);
  
  @media (min-width: 1024px) {
    transform: translateX(0);
  }
  
  &--open {
    transform: translateX(0);
  }
  
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4);
    border-bottom: var(--border-width-1) solid var(--border-default);
  }
  
  &__logo {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--primary);
  }
  
  &__nav {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }
  
  &__item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    margin-bottom: var(--space-1);
    color: var(--text-secondary);
    text-decoration: none;
    border-radius: var(--radius-lg);
    transition: var(--transition-fast);
    cursor: pointer;
    
    &:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }
    
    &--active {
      background: var(--primary-subtle);
      color: var(--primary-dark);
      font-weight: var(--font-medium);
    }
    
    svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
  }
  
  &__footer {
    padding: var(--space-4);
    border-top: var(--border-width-1) solid var(--border-default);
  }
}
```

### Page Layout

```scss
.page {
  min-height: 100vh;
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
  
  @media (min-width: 1024px) {
    padding-left: 280px;
    padding-bottom: 0;
  }
  
  &__header {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4);
    background: var(--bg-secondary);
    border-bottom: var(--border-width-1) solid var(--border-default);
    backdrop-filter: blur(12px);
    
    @media (min-width: 768px) {
      padding: var(--space-4) var(--space-6);
    }
  }
  
  &__title {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--text-primary);
    
    @media (min-width: 768px) {
      font-size: var(--text-2xl);
    }
  }
  
  &__content {
    padding: var(--space-4);
    max-width: var(--container-max);
    margin: 0 auto;
    
    @media (min-width: 768px) {
      padding: var(--space-6);
    }
    
    @media (min-width: 1024px) {
      padding: var(--space-8);
    }
  }
  
  &__section {
    margin-bottom: var(--space-8);
  }
  
  &__section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  
  &__section-title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }
}
```

---

## 🎨 Iconografía

### Icon Set Recomendado

Usar **Lucide Icons** o **Heroicons** por consistencia:

```scss
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  &--xs { width: 12px; height: 12px; }
  &--sm { width: 16px; height: 16px; }
  &--md { width: 20px; height: 20px; }
  &--lg { width: 24px; height: 24px; }
  &--xl { width: 32px; height: 32px; }
}
```

### Iconos por Categoría

```typescript
// icons.ts
export const icons = {
  // Navegación
  home: 'Home',
  search: 'Search',
  pantry: 'Package',
  recipes: 'BookOpen',
  calendar: 'Calendar',
  settings: 'Settings',
  profile: 'User',
  
  // Acciones
  add: 'Plus',
  edit: 'Pencil',
  delete: 'Trash2',
  save: 'Check',
  close: 'X',
  back: 'ArrowLeft',
  forward: 'ArrowRight',
  up: 'ChevronUp',
  down: 'ChevronDown',
  
  // Recetas
  clock: 'Clock',
  timer: 'Timer',
  servings: 'Users',
  difficulty: 'Gauge',
  calories: 'Flame',
  favorite: 'Heart',
  share: 'Share2',
  print: 'Printer',
  
  // Despensa
  ingredient: 'Apple',
  utensil: 'Utensils',
  expiration: 'AlertCircle',
  quantity: 'Hash',
  category: 'Tag',
  location: 'MapPin',
  
  // IA
  ai: 'Sparkles',
  generate: 'Wand2',
  recommend: 'ThumbsUp',
  plan: 'CalendarDays',
  
  // Estados
  success: 'CheckCircle2',
  warning: 'AlertTriangle',
  error: 'XCircle',
  info: 'Info',
  loading: 'Loader2',
  
  // Usuario
  user: 'User',
  users: 'Users',
  household: 'Home',
  invite: 'UserPlus',
  logout: 'LogOut',
  login: 'LogIn',
} as const;
```

---

## 📱 Responsive Breakpoints

```scss
// Mixins
@mixin mobile {
  @media (max-width: 480px) { @content; }
}

@mixin tablet {
  @media (min-width: 481px) and (max-width: 768px) { @content; }
}

@mixin tablet-up {
  @media (min-width: 481px) { @content; }
}

@mixin desktop {
  @media (min-width: 769px) and (max-width: 1024px) { @content; }
}

@mixin desktop-up {
  @media (min-width: 769px) { @content; }
}

@mixin wide {
  @media (min-width: 1025px) { @content; }
}

// Uso
.page__title {
  font-size: var(--text-xl);
  
  @include tablet-up {
    font-size: var(--text-2xl);
  }
  
  @include desktop-up {
    font-size: var(--text-3xl);
  }
}
```

---

## 🌙 Modo Oscuro

### Implementación

```typescript
// theme.service.ts
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private theme$ = new BehaviorSubject<'light' | 'dark' | 'system'>('system');
  
  constructor() {
    this.initTheme();
  }
  
  private initTheme(): void {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | 'system';
    if (saved) {
      this.setTheme(saved);
    } else {
      this.setTheme('system');
    }
  }
  
  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.theme$.next(theme);
    localStorage.setItem('theme', theme);
    
    if (theme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }
  
  getTheme(): Observable<'light' | 'dark' | 'system'> {
    return this.theme$.asObservable();
  }
  
  isDark(): Observable<boolean> {
    return this.theme$.pipe(
      map(theme => {
        if (theme === 'system') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return theme === 'dark';
      })
    );
  }
}
```

---

## 🌐 Idioma y textos (i18n)

**Ningún texto de la interfaz se escribe en el componente.** Lo que la app dice sale de
`frontend/src/app/core/i18n/dict/<dominio>.ts`, un fichero por pantalla, y se pide con la pipe `| t` en la
plantilla o con `i18n.t(clave)` en el código. El motivo es de lo más prosaico: al cambiar a inglés quedaban
etiquetas, placeholders y `title` en español repartidos por 29 pantallas, y ningún compilador se queja de eso.

### Cómo se pide un texto

| Caso | Se escribe | No se escribe |
|---|---|---|
| Texto fijo | `{{ 'nav.recipes' \| t }}` | `>Recetas<` |
| Con un dato dentro | `{{ 'recipes.porciones' \| t:{n: recipe.servings} }}` con `'👥 {n} porciones'` | `👥 {{ n }} porciones` |
| Un plural | `i18n.plural(n, 'dom.uno', 'dom.varios', { count: n })`, con las dos claves en el diccionario | `{{ n !== 1 ? 's' : '' }}`, o pegar el número y la palabra en la plantilla |
| Tiempo relativo | `i18n.relativeTime(iso)`, que compone sobre las partes de `relativeTimeParts` (`core/time.ts`) | un `formatRelative()` que devuelva «hace 3 d» |
| Etiqueta de un catálogo | `labelKey: TranslationKey` en el modelo y `\| t` al pintar | `label: 'Desayuno'` en un `readonly` de la clase, o `admin: 'Administrador'` en un `Record` |
| Valor de fábrica de un `@Input` | Input sin valor + getter con `t()` | `@Input() label = 'Unidad o formato'` |
| Un atributo de presentación | `[searchPlaceholder]="'dom.clave' \| t"` —el nombre no importa: **cualquier** atributo acabado en `label`, `title`, `message`, `hint`, `placeholder`, `text`, `subtitle`, `description`, `question`, `tooltip` o `alt` es texto | `customPlaceholder="Otra alergia"`, `data-label="Tienda"` (esto lo pinta el CSS con `content: attr()`, así que se ve) |
| Lo que devuelve un `*Label` | `cookingLevelWord(level, (k) => this.i18n.t(k))` —texto ya resuelto | `return COOKING_LEVEL_LABEL_KEYS[level]`, que devuelve la clave y el `{{ }}` la pinta |

Reglas que se siguen de ahí, y que no son estilo sino física del framework:

- **Un texto que se guarda en un campo de clase se congela en el idioma en el que se creó el componente.** La
  pipe `t` es impura a propósito: se re-evalúa al cambiar de idioma. Por eso se resuelve al renderizar (getter
  o template) y nunca al construir.
- **Dentro del objeto de parámetros no puede haber otra pipe** (`t:{name: x || ('k' | t)}` no compila). Si un
  texto necesita a otro dentro, sale un getter al `.ts`.
- **Una frase, una clave.** Antes de acuñar, el extractor busca el texto en todos los dominios; `common.*` y
  `ui.*` ganan. `scripts/i18n-merge-dupes.mjs` vuelve a juntar lo que se duplicó.
- **Un módulo sin inyección no tiene idioma, así que no lo inventa.** Los helpers puros (`core/avatar-image.ts`,
  `core/onboarding-steps.ts`, `features/account/account-info.ts`, `shared/models/*`) devuelven **clave**
  (`TranslationKey`, a veces con `params`), nunca la frase: quien la traduce es la pantalla, que es donde vive
  `i18n`. Un `return 'Nada pendiente de enviar'` en un módulo puro se pinta en castellano con la app en inglés.
- **Lo que formatea `Intl` también sigue el idioma.** El locale de formato vive en `core/time.ts`
  (`dateLocale()`) y lo fija el `I18nService` (`en` → `en-GB`, lo demás → `es-ES`) en su `effect` y en
  `languagechange`. Nada de `'es-ES'` literal dentro de un componente: separadores de miles, días de la semana
  y «septiembre de 2026» salen de ahí, y los memoizadores guardan el idioma dentro de la clave de caché.
- **Un catálogo pinta lo que lleva dentro.** `tabs = [{ label: 'Activas' }]` con `{{ tab.label }}` es una
  pantalla que no cambia nunca de idioma, y cambia de golpe en todas las que comparten el catálogo. La lista de
  opciones lleva la **clave**; quien no pueda aplicar la pipe (un `PickerOption[]`, el `aria-label` de una
  sección) resuelve `this.i18n.t(clave)` una vez dentro de un `computed`. Cuando el catálogo ya estaba escrito
  como dato (los alérgenos y gustos del perfil, las categorías de la compra), el dato no se toca y se traduce
  en el punto de pintura con un mapa valor → clave —`tasteLabelKey`, `listCategoryLabelKey` en
  `core/i18n/labels.ts`—; lo que no está en el catálogo se pinta tal cual, porque es texto escrito por la
  persona y la pantalla no tiene derecho a corregirlo.
- **Traducible es lo que la app dice, no lo que la casa guarda.** Los nombres que **escribió una persona**
  (alimentos propios, categorías de la cesta, alérgenos, el nombre de una receta, las líneas de un ticket
  fotografiado) se muestran tal cual: traducirlos haría que la pantalla mintiera sobre la base de datos. Lo
  mismo aplica a lo que entiende el planificador: esas cadenas viven en el server (`MEAL_TYPE_LABELS`) y la app
  las enseña con `t('meal.<tipo>')`, que en castellano dice lo mismo. Un dato que a la vez es texto de interfaz
  se distingue por el nombre del campo —`value`/`aiLabel`, no `label`—.
- **Lo que sembró la app no es texto de la persona: se traduce la lectura.** `server/src/utils/seed-data.ts` crea
  la despensa (68 alimentos) y el juego de utensilios (54) con el nombre en castellano, y nadie los escribió:
  dejarlos crudos no es respetar su texto, es enseñarle su propio semillero. Se resuelve en el punto de pintura
  con `catalogLabelKey` / la pipe `catalog` (`shared/pipes/catalog-label.pipe.ts`), igual que gustos y
  categorías, y la regla tiene tres tramos que no se pueden mezclar:
  **lectura** de una palabra del catálogo → etiqueta traducida si está en el catálogo, crudo si no lo está;
  **campo editable** (el input donde se escribe, el selector de unidades que guarda el dato) → el dato tal cual,
  porque traducir lo que se edita es reescribir la base de datos con un golpe de idioma; **texto de una persona o
  de la IA** → crudo siempre, aunque se parezca a una palabra del catálogo.
- **Un tipo del cliente que describe otras cosas que el contrato del server es un bug silencioso.**
  `ListEventAction` llevaba nueve acciones inventadas (`items.add`, `list.rename`, `list.clear_checked`…) que el
  server nunca mandó, y nadie las usaba mal porque nadie las podía usar: el historial se componía en el server y
  se pintaba `description`. Cuando un dato puede traducirse de dos formas —frase del server o clave del
  diccionario— hay que mirar cuál es la fuente. Los `*.spec.ts` espejos en `server/src/utils/`
  (`shopping-list-event-i18n`, `pantry-catalog-i18n`, `meal-times-mirror`) son la forma de que no se vuelva a
  desincronizar: leen el fuente del server y el del cliente y comparan, y fallan en CI.
- **Antes de traducir un atributo, comprobar que existe.** `app-picker` no declara `emptyText`, y durante
  media app había tres `emptyText="…"` que Angular trataba como atributo de DOM corriente: no se pintaban,
  no fallaban y la regla los veía como texto. Un literal que no llega a la pantalla se borra, con su clave
  huérfana fuera del diccionario (HOGARIA-SPEC ## 12v).

### Quién lo vigila

`scripts/check-ui.mjs`, reglas 14 (`texto-sin-traducir`: también los nodos de texto que pegan a una `{{ }}`, y
**cualquier** atributo acabado en `label`/`title`/`message`/`hint`/`placeholder`/`text`/`subtitle`/`description`
/`question`/`tooltip`/`alt` —desde la tanda 23 por sufijo y no por lista, que `customPlaceholder` y
`data-label` no estaban en la lista y se veían en castellano—), 15 (`clave-sin-traduccion`: la clave existe en `es`
**y** en `en`, y se usa en algún sitio), 16 (`pipe-sin-importar`), 17 (`data-test-huerfano`), 18
(`prosa-en-un-sink`: literal con pinta de frase que acaba en `toast.*`, `*Error.set`, `note`, `title` o un
`return`, dentro o fuera de `t()` —incluidos el `cond ? 'prosa' : 'prosa'` y las variables `t(clave)`— y 19
(`texto-en-un-catalogo`: el campo de presentación con la frase escrita, el getter que devuelve la frase en vez de
la clave y el `Record<clave, etiqueta>`) y 20 (`clave-pintada-desnuda`: una clave del
diccionario que llega cruda a un `{{ }}`, o un `*Label` que devuelve la clave en vez del texto). Además el tipo:
`TranslationKey` es la unión de claves reales, así que una errata en una plantilla es error de compilación con
`strictTemplates`. Contrato y deudas en `HOGARIA-SPEC.md` §12s, §12u, §12v y §12w.

- [ ] **Pendiente**: los pictogramas dentro de las claves (`📦 Despensa`, `⏱️ {n}min`) están perdonados por
      `sin-emoji` en cinco diccionarios. Decidir si son decoración (se quitan) o información (pasan a
      `app-icon`) es una tanda con sus capturas, no un retoque.

---

## ✅ Checklist de Implementación UI

### Componentes Base
- [ ] Button (5 variantes × 3 tamaños)
- [ ] Input (text, number, search, textarea)
- [ ] Select (single, multi, searchable)
- [ ] Checkbox
- [ ] Radio
- [ ] Toggle/Switch
- [ ] Badge (6 variantes)
- [ ] Tag (removable)
- [ ] Avatar (image, initials, icon)
- [ ] Tooltip
- [ ] Modal
- [ ] Toast/Notification
- [ ] Loading/Spinner
- [ ] Skeleton
- [ ] Progress bar
- [ ] Rating (stars)

### Componentes de Receta
- [ ] RecipeCard
- [ ] RecipeDetail
- [ ] IngredientItem
- [ ] StepCard
- [ ] Timer
- [ ] NutritionChart
- [ ] DifficultyBadge

### Layouts
- [ ] MainLayout (sidebar + header + content)
- [ ] AuthLayout
- [ ] BottomNav (mobile)
- [ ] Sidebar (desktop)
- [ ] PageHeader
- [ ] PageContent

### Páginas
- [ ] Home/Dashboard
- [ ] Pantry
- [ ] Recipes
- [ ] RecipeDetail
- [ ] Calendar
- [ ] Household
- [ ] AI Config
- [ ] Settings
- [ ] Profile
- [ ] Login/Register

---

**Última actualización:** 2026-09-21  
**Versión:** 1.1.0  
**Qué cambió:** la sección de idioma y textos (tanda 20): todo texto de la interfaz sale del diccionario, y
hay cuatro reglas de `check-ui` que lo exigen.
