import { logsEn, logsEs } from './logs';

describe('log filter translations', () => {
  it('provides accessible source and level labels in Spanish and English', () => {
    expect(logsEs['logs.fuente_filtro_label']).toBe('Filtrar por fuente');
    expect(logsEs['logs.nivel_filtro_label']).toBe('Filtrar por nivel');
    expect(logsEn['logs.fuente_filtro_label']).toBe('Filter by log source');
    expect(logsEn['logs.nivel_filtro_label']).toBe('Filter by log level');
  });

  it('provides server runtime and image labels in Spanish and English', () => {
    expect(logsEs['logs.server_uptime']).toBe('Tiempo encendido');
    expect(logsEs['logs.image_ref']).toBe('Imagen GHCR');
    expect(logsEs['logs.image_local']).toContain('sin etiqueta GHCR');
    expect(logsEn['logs.server_uptime']).toBe('Server uptime');
    expect(logsEn['logs.image_ref']).toBe('GHCR image');
    expect(logsEn['logs.image_local']).toContain('no GHCR tag');
  });
});
