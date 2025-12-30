// server.js - Backend API para Railway/Render
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static(__dirname));

// Configuración de la base de datos
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000, // 30 segundos para establecer conexión
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Pool de conexiones
const pool = mysql.createPool(dbConfig);

// Verificar conexión al iniciar
pool.getConnection()
  .then(connection => {
    console.log('✅ Conexión a base de datos establecida correctamente');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Error al conectar a la base de datos:', err.message);
    console.error('Verifica las credenciales y que el servidor MySQL sea accesible');
  });

// ============ ENDPOINTS SIMULACRO ============

// Endpoint para estadísticas del simulacro
app.get('/api/stats', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [inscritosResult] = await connection.query(
      'SELECT COUNT(*) as total FROM inscripcion_simulacros'
    );
    
    const [pagadosResult] = await connection.query(
      `SELECT COUNT(*) as total 
       FROM banco_pagos
       WHERE fch_pag BETWEEN '2025-11-27' AND '2025-12-13'
         AND imp_pag > 14 
         AND imp_pag <= 18`
    );
    
    connection.release();
    
    const stats = {
      totalInscritos: inscritosResult[0].total,
      totalPagados: pagadosResult[0].total,
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
    
  } catch (error) {
    console.error('Error en la consulta:', error);
    res.status(500).json({ 
      error: 'Error al obtener datos',
      message: error.message 
    });
  }
});

// Endpoint para inscritos por área (simulacro)
app.get('/api/inscritos-por-area', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    
    const [result] = await connection.query(`
      SELECT 
        a.denominacion as area,
        COUNT(DISTINCT ise.nro_documento) as total_inscritos
      FROM inscripcion_simulacros ise
      INNER JOIN estudiantes e ON ise.nro_documento = e.nro_documento
      INNER JOIN inscripciones i ON e.id = i.estudiantes_id
      INNER JOIN areas a ON i.areas_id = a.id
      WHERE i.periodos_id = 1
      GROUP BY a.id, a.denominacion
      ORDER BY a.denominacion
    `);
    
    connection.release();
    
    res.json({
      areas: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error en la consulta de áreas:', error);
    res.status(500).json({ 
      error: 'Error al obtener datos por área',
      message: error.message 
    });
  }
});

// ============ ENDPOINTS MATRÍCULAS ============

// 1. Totales Generales
app.get('/api/matriculas/totales', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        COUNT(DISTINCT m.estudiantes_id) as total_inscritos,
        SUM(CASE WHEN m.habilitado = '1' THEN 1 ELSE 0 END) as total_habilitados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) as total_sincronizados
      FROM matriculas m
      WHERE m.periodos_id = 1
    `);

    connection.release();

    // Convertir a números para asegurar consistencia
    const totales = {
      total_inscritos: parseInt(result[0].total_inscritos) || 0,
      total_habilitados: parseInt(result[0].total_habilitados) || 0,
      total_sincronizados: parseInt(result[0].total_sincronizados) || 0,
      timestamp: new Date().toISOString()
    };

    res.json(totales);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener totales', message: error.message });
  }
});

// 2. Desglose por Área
app.get('/api/matriculas/por-area', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        a.denominacion AS area,
        COUNT(DISTINCT m.estudiantes_id) AS total_estudiantes,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) AS total_sincronizados,
        ROUND((SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) * 100.0) / COUNT(DISTINCT m.estudiantes_id), 2) AS porcentaje_sincronizados
      FROM
        matriculas m
        INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
        INNER JOIN areas a ON ga.areas_id = a.id
      WHERE
        m.periodos_id = 1
      GROUP BY
        a.id, a.denominacion
      ORDER BY
        total_estudiantes DESC
    `);

    connection.release();

    // Convertir a números para asegurar consistencia
    const areas = result.map(row => ({
      area: row.area,
      total_estudiantes: parseInt(row.total_estudiantes) || 0,
      total_sincronizados: parseInt(row.total_sincronizados) || 0,
      porcentaje_sincronizados: parseFloat(row.porcentaje_sincronizados) || 0
    }));

    res.json({
      areas,
      total_areas: areas.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener datos por área', message: error.message });
  }
});

// 3. Desglose por Sede
app.get('/api/matriculas/por-sede', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        s.id as sede_id,
        s.denominacion AS sede,
        COUNT(DISTINCT m.estudiantes_id) as total_inscritos,
        SUM(CASE WHEN m.habilitado = '1' THEN 1 ELSE 0 END) as total_habilitados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) as total_sincronizados
      FROM matriculas m
      INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
      INNER JOIN aulas au ON ga.aulas_id = au.id
      INNER JOIN locales l ON au.locales_id = l.id
      INNER JOIN sedes s ON l.sedes_id = s.id
      WHERE m.periodos_id = 1
      GROUP BY s.id, s.denominacion
      ORDER BY s.denominacion
    `);

    connection.release();

    // Convertir valores a números
    const sedes = result.map(row => ({
      sede_id: row.sede_id,
      sede: row.sede,
      total_inscritos: parseInt(row.total_inscritos) || 0,
      total_habilitados: parseInt(row.total_habilitados) || 0,
      total_sincronizados: parseInt(row.total_sincronizados) || 0
    }));

    res.json({ sedes, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener datos por sede', message: error.message });
  }
});

// 3. Desglose por Sede > Área
app.get('/api/matriculas/por-sede-area', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        s.id as sede_id,
        s.denominacion AS sede,
        a.id as area_id,
        a.denominacion AS area,
        COUNT(DISTINCT m.estudiantes_id) as total_inscritos,
        SUM(CASE WHEN m.habilitado = '1' THEN 1 ELSE 0 END) as total_habilitados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) as total_sincronizados
      FROM matriculas m
      INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
      INNER JOIN areas a ON ga.areas_id = a.id
      INNER JOIN aulas au ON ga.aulas_id = au.id
      INNER JOIN locales l ON au.locales_id = l.id
      INNER JOIN sedes s ON l.sedes_id = s.id
      WHERE m.periodos_id = 1
      GROUP BY s.id, s.denominacion, a.id, a.denominacion
      ORDER BY s.denominacion, a.denominacion
    `);

    connection.release();

    // Convertir valores a números
    const data = result.map(row => ({
      sede_id: row.sede_id,
      sede: row.sede,
      area_id: row.area_id,
      area: row.area,
      total_inscritos: parseInt(row.total_inscritos) || 0,
      total_habilitados: parseInt(row.total_habilitados) || 0,
      total_sincronizados: parseInt(row.total_sincronizados) || 0
    }));

    res.json({ data, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener datos', message: error.message });
  }
});

// 4. Desglose por Sede > Área > Turno
app.get('/api/matriculas/por-sede-area-turno', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        s.id as sede_id,
        s.denominacion AS sede,
        a.id as area_id,
        a.denominacion AS area,
        t.id as turno_id,
        t.denominacion AS turno,
        COUNT(DISTINCT m.estudiantes_id) as total_inscritos,
        SUM(CASE WHEN m.habilitado = '1' THEN 1 ELSE 0 END) as total_habilitados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) as total_sincronizados
      FROM matriculas m
      INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
      INNER JOIN areas a ON ga.areas_id = a.id
      INNER JOIN turnos t ON ga.turnos_id = t.id
      INNER JOIN aulas au ON ga.aulas_id = au.id
      INNER JOIN locales l ON au.locales_id = l.id
      INNER JOIN sedes s ON l.sedes_id = s.id
      WHERE m.periodos_id = 1
      GROUP BY s.id, s.denominacion, a.id, a.denominacion, t.id, t.denominacion
      ORDER BY s.denominacion, a.denominacion, t.denominacion
    `);

    connection.release();

    // Convertir valores a números
    const data = result.map(row => ({
      sede_id: row.sede_id,
      sede: row.sede,
      area_id: row.area_id,
      area: row.area,
      turno_id: row.turno_id,
      turno: row.turno,
      total_inscritos: parseInt(row.total_inscritos) || 0,
      total_habilitados: parseInt(row.total_habilitados) || 0,
      total_sincronizados: parseInt(row.total_sincronizados) || 0
    }));

    res.json({ data, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener datos', message: error.message });
  }
});

// 5. Desglose completo: Sede > Área > Turno > Grupo
app.get('/api/matriculas/completo', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        s.id as sede_id,
        s.denominacion AS sede,
        a.id as area_id,
        a.denominacion AS area,
        t.id as turno_id,
        t.denominacion AS turno,
        g.id as grupo_id,
        g.denominacion AS grupo,
        COUNT(DISTINCT m.estudiantes_id) as total_inscritos,
        SUM(CASE WHEN m.habilitado = '1' THEN 1 ELSE 0 END) as total_habilitados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '1' THEN 1 ELSE 0 END) as total_sincronizados,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '0' THEN 1 ELSE 0 END) as total_pendientes,
        SUM(CASE WHEN m.habilitado = '1' AND m.habilitado_estado = '2' THEN 1 ELSE 0 END) as total_error
      FROM matriculas m
      INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
      INNER JOIN grupos g ON ga.grupos_id = g.id
      INNER JOIN areas a ON ga.areas_id = a.id
      INNER JOIN turnos t ON ga.turnos_id = t.id
      INNER JOIN aulas au ON ga.aulas_id = au.id
      INNER JOIN locales l ON au.locales_id = l.id
      INNER JOIN sedes s ON l.sedes_id = s.id
      WHERE m.periodos_id = 1
      GROUP BY s.id, s.denominacion, a.id, a.denominacion, t.id, t.denominacion, g.id, g.denominacion
      ORDER BY s.denominacion, a.denominacion, t.denominacion, g.denominacion
    `);

    connection.release();

    // Convertir valores a números
    const data = result.map(row => ({
      sede_id: row.sede_id,
      sede: row.sede,
      area_id: row.area_id,
      area: row.area,
      turno_id: row.turno_id,
      turno: row.turno,
      grupo_id: row.grupo_id,
      grupo: row.grupo,
      total_inscritos: parseInt(row.total_inscritos) || 0,
      total_habilitados: parseInt(row.total_habilitados) || 0,
      total_sincronizados: parseInt(row.total_sincronizados) || 0,
      total_pendientes: parseInt(row.total_pendientes) || 0,
      total_error: parseInt(row.total_error) || 0
    }));

    res.json({ data, timestamp: new Date().toISOString() });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener datos', message: error.message });
  }
});

// 6. Detalle de estudiantes pendientes sin deuda por grupo
app.get('/api/matriculas/pendientes-sin-deuda/detalle', async (req, res) => {
  try {
    const { sede, area, turno, grupo } = req.query;

    if (!sede || !area || !turno || !grupo) {
      return res.status(400).json({
        error: 'Parámetros requeridos: sede, area, turno, grupo'
      });
    }

    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        e.nro_documento AS dni,
        CONCAT(e.paterno, ' ', e.materno, ' ', e.nombres) AS apellidos_nombres,
        s.denominacion AS sede,
        a.denominacion AS area,
        t.denominacion AS turno,
        g.denominacion AS grupo,
        SUM(te.monto) AS total_tarifa,
        SUM(te.pagado) AS total_pagado,
        SUM(te.monto - te.pagado) AS deuda_total
      FROM
        estudiantes e
        INNER JOIN inscripciones i ON e.id = i.estudiantes_id
        INNER JOIN matriculas m ON e.id = m.estudiantes_id AND m.periodos_id = 1
        INNER JOIN tarifa_estudiantes te ON e.id = te.estudiantes_id
        INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
        INNER JOIN grupos g ON ga.grupos_id = g.id
        INNER JOIN areas a ON ga.areas_id = a.id
        INNER JOIN turnos t ON ga.turnos_id = t.id
        INNER JOIN aulas au ON ga.aulas_id = au.id
        INNER JOIN locales l ON au.locales_id = l.id
        INNER JOIN sedes s ON l.sedes_id = s.id
      WHERE
        i.periodos_id = 1
        AND m.habilitado = '0'
        AND s.denominacion = ?
        AND a.denominacion = ?
        AND t.denominacion = ?
        AND g.denominacion = ?
      GROUP BY
        e.id,
        e.nro_documento,
        e.paterno,
        e.materno,
        e.nombres,
        s.denominacion,
        a.denominacion,
        t.denominacion,
        g.denominacion
      HAVING
        SUM(te.monto - te.pagado) <= 0
      ORDER BY
        e.paterno,
        e.materno,
        e.nombres
    `, [sede, area, turno, grupo]);

    connection.release();

    // Convertir valores a números
    const estudiantes = result.map(row => ({
      dni: row.dni,
      apellidos_nombres: row.apellidos_nombres,
      sede: row.sede,
      area: row.area,
      turno: row.turno,
      grupo: row.grupo,
      total_tarifa: parseFloat(row.total_tarifa) || 0,
      total_pagado: parseFloat(row.total_pagado) || 0,
      deuda_total: parseFloat(row.deuda_total) || 0
    }));

    res.json({
      estudiantes,
      total: estudiantes.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al obtener detalle de estudiantes',
      message: error.message
    });
  }
});

// 7. Estudiantes sin deuda pero no habilitados
app.get('/api/matriculas/pendientes-sin-deuda', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        s.denominacion AS sede,
        a.denominacion AS area,
        t.denominacion AS turno,
        g.denominacion AS grupo,
        COUNT(*) AS total_no_habilitados_sin_deuda
      FROM (
        SELECT
          e.id,
          s.id AS sede_id,
          a.id AS area_id,
          t.id AS turno_id,
          g.id AS grupo_id
        FROM
          estudiantes e
          INNER JOIN matriculas m ON e.id = m.estudiantes_id AND m.periodos_id = 1
          INNER JOIN tarifa_estudiantes te ON e.id = te.estudiantes_id
          INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
          INNER JOIN grupos g ON ga.grupos_id = g.id
          INNER JOIN areas a ON ga.areas_id = a.id
          INNER JOIN turnos t ON ga.turnos_id = t.id
          INNER JOIN aulas au ON ga.aulas_id = au.id
          INNER JOIN locales l ON au.locales_id = l.id
          INNER JOIN sedes s ON l.sedes_id = s.id
        WHERE
          m.habilitado = '0'
        GROUP BY
          e.id,
          s.id,
          a.id,
          t.id,
          g.id
        HAVING
          SUM(te.monto - te.pagado) <= 0
      ) AS estudiantes_sin_deuda
      INNER JOIN sedes s ON estudiantes_sin_deuda.sede_id = s.id
      INNER JOIN areas a ON estudiantes_sin_deuda.area_id = a.id
      INNER JOIN turnos t ON estudiantes_sin_deuda.turno_id = t.id
      INNER JOIN grupos g ON estudiantes_sin_deuda.grupo_id = g.id
      GROUP BY
        s.id,
        s.denominacion,
        a.id,
        a.denominacion,
        t.id,
        t.denominacion,
        g.id,
        g.denominacion
      ORDER BY
        s.denominacion,
        a.denominacion,
        t.denominacion,
        g.denominacion
    `);

    connection.release();

    // Convertir valores a números
    const data = result.map(row => ({
      sede: row.sede,
      area: row.area,
      turno: row.turno,
      grupo: row.grupo,
      total_no_habilitados_sin_deuda: parseInt(row.total_no_habilitados_sin_deuda) || 0
    }));

    // Calcular total general
    const total_general = data.reduce((sum, row) => sum + row.total_no_habilitados_sin_deuda, 0);

    res.json({
      data,
      total_general,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error al obtener pendientes sin deuda', message: error.message });
  }
});

// 8. Estudiantes habilitados con deuda pendiente (ALERTA)
app.get('/api/matriculas/habilitados-con-deuda', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        e.nro_documento as dni,
        CONCAT(e.paterno, ' ', e.materno, ' ', e.nombres) as apellidos_nombres,
        s.denominacion as sede,
        a.denominacion as area,
        t.denominacion as turno,
        g.denominacion as grupo,
        SUM(te.monto - te.pagado) as deuda_total
      FROM estudiantes e
      INNER JOIN inscripciones i ON e.id = i.estudiantes_id
      INNER JOIN matriculas m ON e.id = m.estudiantes_id AND m.periodos_id = 1
      INNER JOIN tarifa_estudiantes te ON e.id = te.estudiantes_id
      INNER JOIN sedes s ON i.sedes_id = s.id
      INNER JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
      INNER JOIN grupos g ON ga.grupos_id = g.id
      INNER JOIN areas a ON ga.areas_id = a.id
      INNER JOIN turnos t ON ga.turnos_id = t.id
      WHERE
        i.periodos_id = 1
        AND m.habilitado = '1'
      GROUP BY
        e.id,
        e.nro_documento,
        e.paterno,
        e.materno,
        e.nombres,
        s.denominacion,
        a.denominacion,
        t.denominacion,
        g.denominacion
      HAVING
        SUM(te.monto - te.pagado) > 0
      ORDER BY
        SUM(te.monto - te.pagado) DESC,
        e.paterno,
        e.materno,
        e.nombres
    `);

    connection.release();

    // Convertir valores a números
    const estudiantes = result.map(row => ({
      dni: row.dni,
      apellidos_nombres: row.apellidos_nombres,
      sede: row.sede,
      area: row.area,
      turno: row.turno,
      grupo: row.grupo,
      deuda_total: parseFloat(row.deuda_total) || 0
    }));

    res.json({
      estudiantes,
      total: estudiantes.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al obtener habilitados con deuda',
      message: error.message
    });
  }
});

// 9. Progreso de habilitaciones por auxiliar (TESTING - NO PUBLICAR)
app.get('/api/matriculas/progreso-auxiliares', async (req, res) => {
  try {
    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        dates.fecha,
        u.id AS auxiliar_id,
        CONCAT(u.paterno, ' ', u.materno, ', ', u.name) AS auxiliar,
        COALESCE(COUNT(a.id), 0) AS total_habilitados
      FROM (
        SELECT DATE('2025-12-01') + INTERVAL (a.a + (10 * b.a)) DAY AS fecha
        FROM (SELECT 0 AS a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3
              UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
              UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) AS a
        CROSS JOIN (SELECT 0 AS a UNION ALL SELECT 1 UNION ALL SELECT 2) AS b
        WHERE DATE('2025-12-01') + INTERVAL (a.a + (10 * b.a)) DAY <= '2025-12-23'
      ) AS dates
      CROSS JOIN users u
      LEFT JOIN audits a ON DATE(a.created_at) = dates.fecha
        AND a.user_id = u.id
        AND a.auditable_type = 'App\\\\Models\\\\Matricula'
        AND a.event = 'updated'
        AND a.old_values LIKE '%"habilitado":"0"%'
        AND a.new_values LIKE '%"habilitado":"1"%'
      WHERE
        u.estado = '1'
      GROUP BY
        dates.fecha,
        u.id,
        u.paterno,
        u.materno,
        u.name
      ORDER BY
        auxiliar, dates.fecha
    `);

    connection.release();

    // Agrupar datos por auxiliar
    const auxiliaresMap = {};

    result.forEach(row => {
      const auxiliarId = row.auxiliar_id;

      if (!auxiliaresMap[auxiliarId]) {
        auxiliaresMap[auxiliarId] = {
          auxiliar_id: auxiliarId,
          auxiliar: row.auxiliar,
          fechas: [],
          totales: []
        };
      }

      auxiliaresMap[auxiliarId].fechas.push(row.fecha);
      auxiliaresMap[auxiliarId].totales.push(parseInt(row.total_habilitados) || 0);
    });

    const auxiliares = Object.values(auxiliaresMap);

    res.json({
      auxiliares,
      total_auxiliares: auxiliares.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al obtener progreso de auxiliares',
      message: error.message
    });
  }
});

// Búsqueda de estudiante por DNI para descarga de constancia
app.get('/api/matriculas/buscar-por-dni/:dni', async (req, res) => {
  try {
    const { dni } = req.params;

    if (!dni || dni.trim() === '') {
      return res.status(400).json({ error: 'DNI es requerido' });
    }

    const connection = await pool.getConnection();

    const [result] = await connection.query(`
      SELECT
        m.id AS matricula_id,
        e.nro_documento AS dni,
        CONCAT(e.paterno, ' ', e.materno, ' ', e.nombres) AS apellidos_nombres,
        m.habilitado,
        m.habilitado_estado,
        s.denominacion AS sede,
        a.denominacion AS area,
        t.denominacion AS turno,
        g.denominacion AS grupo
      FROM
        estudiantes e
        INNER JOIN matriculas m ON e.id = m.estudiantes_id
        LEFT JOIN grupo_aulas ga ON m.grupo_aulas_id = ga.id
        LEFT JOIN grupos g ON ga.grupos_id = g.id
        LEFT JOIN areas a ON ga.areas_id = a.id
        LEFT JOIN turnos t ON ga.turnos_id = t.id
        LEFT JOIN aulas au ON ga.aulas_id = au.id
        LEFT JOIN locales l ON au.locales_id = l.id
        LEFT JOIN sedes s ON l.sedes_id = s.id
      WHERE
        e.nro_documento = ?
        AND m.periodos_id = 1
      LIMIT 1
    `, [dni]);

    connection.release();

    if (result.length === 0) {
      return res.status(404).json({
        error: 'No se encontró estudiante con ese DNI',
        dni: dni
      });
    }

    const estudiante = result[0];

    res.json({
      matricula_id: estudiante.matricula_id,
      dni: estudiante.dni,
      apellidos_nombres: estudiante.apellidos_nombres,
      habilitado: estudiante.habilitado === '1',
      habilitado_estado: estudiante.habilitado_estado === '1',
      sede: estudiante.sede,
      area: estudiante.area,
      turno: estudiante.turno,
      grupo: estudiante.grupo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al buscar estudiante',
      message: error.message
    });
  }
});

// Generar token encriptado para descarga de constancia
app.get('/api/matriculas/generar-token/:matricula_id', async (req, res) => {
  try {
    const { matricula_id } = req.params;

    if (!matricula_id || isNaN(matricula_id)) {
      return res.status(400).json({ error: 'ID de matrícula inválido' });
    }

    // Hacer petición a la API externa para obtener el token
    const response = await fetch(`https://sistemas.cepreuna.edu.pe/api/perfil/encrypt/${matricula_id}`);

    if (!response.ok) {
      throw new Error(`Error al generar token: ${response.status} ${response.statusText}`);
    }

    // La API devuelve el token como texto plano, no como JSON
    const token = await response.text();

    res.json({
      token: token,
      pdf_url: `https://sistemas.cepreuna.edu.pe/dga/estudiantes/pdf-constancia/${token}`,
      matricula_id: parseInt(matricula_id),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: 'Error al generar token',
      message: error.message
    });
  }
});

// Endpoint de salud
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Iniciar servidor (solo en desarrollo local)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en puerto ${PORT}`);
  });
}

// Exportar para Vercel
module.exports = app;