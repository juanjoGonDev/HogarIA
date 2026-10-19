# HogarIA — marca e iconos

## El entregable

`hogaria-icon-source.png` (1024 px, 24 bits) es la **fuente de verdad** de la marca:
una casa de trazo grueso en tinta `#1C1917` con el cerebro de robot en naranja
`#F97316` ocupando el hueco de la puerta. Dos tonos planos, sin degradados ni
sombras, porque el mismo dibujo tiene que funcionar en un favicon de 16 px y en un
icono de instalación de 512 px.

Nada de lo que ve el navegador se edita a mano: `frontend/src/assets/icons/*` y
`frontend/src/favicon.ico` son **derivados** de este fichero. Si la marca cambia, se
cambia aquí y se regenera el set.

## Regenerar el set (ImageMagick 6, sin dependencias de Node)

```bash
SRC=design/hogaria-icon-source.png          # el maestro
BG='#FAFAF9'                                # == background_color del manifest
OUT=frontend/src/assets/icons

# maestro plano a 512, sin perfiles ni metadatos
convert "$SRC" -strip -background "$BG" -flatten -resize 512x512 -depth 8 PNG24:/tmp/mark-512.png

# iconos de la PWA (los mismos nombres que usa el manifest)
for s in 72 96 128 144 152 192 384 512; do
  convert /tmp/mark-512.png -resize ${s}x${s} -depth 8 PNG24:$OUT/icon-${s}x${s}.png
done

# maskable: la marca al 80 % sobre lienzo del color de fondo -> 10 % de aire por lado,
# que es lo que exige Android al recortar; con -resize a secas el lienzo salia del
# tamano del dibujo, asi que se fuerza el cuadro con -extent.
for s in 192 512; do
  inner=$(( s * 80 / 100 ))
  convert /tmp/mark-512.png -resize ${inner}x${inner} -gravity center -background "$BG" \
          -extent ${s}x${s} -depth 8 PNG24:$OUT/icon-maskable-${s}x${s}.png
done

# iOS y favicons; en 16 y 32 px el trazo se afila o desaparece
convert /tmp/mark-512.png -resize 180x180 -background "$BG" -flatten -depth 8 PNG24:$OUT/apple-touch-icon-180.png
convert /tmp/mark-512.png -resize 32x32 -sharpen 0x0.8 -depth 8 PNG24:$OUT/favicon-32.png
convert /tmp/mark-512.png -resize 16x16 -sharpen 0x0.6 -depth 8 PNG24:$OUT/favicon-16.png
convert /tmp/mark-512.png -resize 48x48 -depth 8 PNG24:/tmp/favicon-48.png
convert $OUT/favicon-16.png $OUT/favicon-32.png /tmp/favicon-48.png \
        -define icon:auto-resize=16,32,48 frontend/src/favicon.ico
```

Comprobar el resultado antes de commitear:

```bash
identify -format "%f %wx%h %b\n" frontend/src/assets/icons/*.png frontend/src/favicon.ico
montage frontend/src/assets/icons/favicon-16.png frontend/src/assets/icons/favicon-32.png \
        frontend/src/assets/icons/icon-72x72.png -tile 3x1 -geometry +8+8 -background gray /tmp/contact.png
```

## Decisiones

- **El `favicon.ico` estaba declarado en `angular.json` y no existía.** Ahora se
  genera de verdad con sus tres tamaños (16/32/48); `index.html` enlaza además los
  PNG de 32 y 16 y el `apple-touch-icon`, que ni estaban declarados ni se copiaban.
- **El manifest mezclaba `purpose: "maskable any"` en los ocho tamaños.** Ahora hay
  dos listas: `any` para las ocho resoluciones de siempre y `maskable` solo para
  192/512, que son las que Android consulta. Con el `maskable` mal declarado, el
  recorte del launcher se comía el alero de la casa en muchos lanzadores.
- **Los `shortcuts` apuntaban a `generate.png` y `pantry.png`, que nunca existieron**,
  y Chrome descartaba el atajo si el icono falla; reusan la marca.
- **Se quitó `screenshots`** por el mismo motivo: apuntaba a `assets/screenshots/*`
  inexistente. Se devolverá el bloque cuando haya capturas reales en el repo.
- El SVG vectorial del logo **no** se enlaza como favicon: sin un trazador
  (`potrace`/`inkscape`) en el proyecto, sería un segundo dibujo parecido pero no
  idéntico, y dos fuentes visuales es exactamente cómo se rompe una marca.
