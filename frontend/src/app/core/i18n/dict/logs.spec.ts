import { logsEn, logsEs } from './logs';

describe('log filter translations', () => {
  it('provides accessible source and level labels in Spanish and English', () => {
    expect(logsEs['logs.fuente_filtro_label']).toBe('Filtrar por fuente');
    expect(logsEs['logs.nivel_filtro_label']).toBe('Filtrar por nivel');
    expect(logsEn['logs.fuente_filtro_label']).toBe('Filter by log source');
    expect(logsEn['logs.nivel_filtro_label']).toBe('Filter by log level');
  });
});
