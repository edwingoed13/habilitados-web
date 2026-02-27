const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuración de la base de datos
let db = null;
let isConnected = false;

try {
    db = mysql.createConnection({
        host: 'mysql-habilitados.alwaysdata.net',
        user: '371964',
        password: 'HABILITADOS_2024_ADMIN*',
        database: 'habilitados_db'
    });

    // Conectar a la base de datos
    db.connect((err) => {
        if (err) {
            console.error('Error conectando a la base de datos:', err);
            console.log('Modo de desarrollo: usando datos de ejemplo');
            isConnected = false;
        } else {
            console.log('Conectado a la base de datos MySQL');
            isConnected = true;
        }
    });
} catch (error) {
    console.error('Error configurando base de datos:', error);
    console.log('Modo de desarrollo: usando datos de ejemplo');
    isConnected = false;
}

// Datos de ejemplo para desarrollo
const ejemploDatos = {
    total: [{ total: 245 }],
    porArea: [
        { area: 'Matemática', total: 65 },
        { area: 'Comunicación', total: 52 },
        { area: 'Ciencias Sociales', total: 38 },
        { area: 'Ciencia y Tecnología', total: 35 },
        { area: 'Educación Física', total: 28 },
        { area: 'Arte y Cultura', total: 27 }
    ],
    ultimos: [
        {
            nombres: 'Juan Carlos',
            apellido_paterno: 'Pérez',
            apellido_materno: 'García',
            area: 'Matemática',
            fecha_inscripcion: new Date('2024-02-26T10:30:00')
        },
        {
            nombres: 'María Isabel',
            apellido_paterno: 'Rodríguez',
            apellido_materno: 'López',
            area: 'Comunicación',
            fecha_inscripcion: new Date('2024-02-26T09:15:00')
        },
        {
            nombres: 'Luis Alberto',
            apellido_paterno: 'Torres',
            apellido_materno: 'Mendoza',
            area: 'Ciencias Sociales',
            fecha_inscripcion: new Date('2024-02-25T16:45:00')
        },
        {
            nombres: 'Ana Patricia',
            apellido_paterno: 'Gutiérrez',
            apellido_materno: 'Silva',
            area: 'Ciencia y Tecnología',
            fecha_inscripcion: new Date('2024-02-25T14:20:00')
        },
        {
            nombres: 'Carlos Eduardo',
            apellido_paterno: 'Vargas',
            apellido_materno: 'Ramos',
            area: 'Educación Física',
            fecha_inscripcion: new Date('2024-02-25T11:10:00')
        }
    ]
};

// Endpoint para obtener estadísticas de inscripciones de docentes
app.get('/api/docentes/estadisticas', (req, res) => {
    // Si no hay conexión, devolver datos de ejemplo
    if (!isConnected || !db) {
        console.log('Devolviendo datos de ejemplo (sin conexión a DB)');
        return res.json(ejemploDatos);
    }

    const queries = {
        // Total de inscritos
        total: `SELECT COUNT(*) as total FROM inscripcion_docentes`,

        // Inscritos por área
        porArea: `
            SELECT
                a.nombre_area as area,
                COUNT(id.id) as total
            FROM inscripcion_docentes id
            LEFT JOIN areas a ON id.areas_id = a.id
            GROUP BY id.areas_id, a.nombre_area
            ORDER BY total DESC
        `,

        // Últimos 10 inscritos
        ultimos: `
            SELECT
                d.nombres,
                d.apellido_paterno,
                d.apellido_materno,
                a.nombre_area as area,
                id.created_at as fecha_inscripcion
            FROM inscripcion_docentes id
            LEFT JOIN docentes d ON id.docentes_id = d.id
            LEFT JOIN areas a ON id.areas_id = a.id
            ORDER BY id.created_at DESC
            LIMIT 10
        `
    };

    let results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;

    // Ejecutar todas las consultas
    for (const [key, query] of Object.entries(queries)) {
        db.query(query, (err, data) => {
            if (err) {
                console.error(`Error en consulta ${key}:`, err);
                results[key] = { error: err.message };
            } else {
                results[key] = data;
            }

            completedQueries++;
            if (completedQueries === totalQueries) {
                res.json(results);
            }
        });
    }
});

// Endpoint para obtener detalle de inscritos por área específica
app.get('/api/docentes/area/:areaId', (req, res) => {
    const { areaId } = req.params;

    const query = `
        SELECT
            d.dni,
            d.nombres,
            d.apellido_paterno,
            d.apellido_materno,
            d.celular,
            d.correo,
            a.nombre_area as area,
            id.created_at as fecha_inscripcion
        FROM inscripcion_docentes id
        LEFT JOIN docentes d ON id.docentes_id = d.id
        LEFT JOIN areas a ON id.areas_id = a.id
        WHERE id.areas_id = ?
        ORDER BY id.created_at DESC
    `;

    db.query(query, [areaId], (err, results) => {
        if (err) {
            console.error('Error en consulta:', err);
            res.status(500).json({ error: 'Error al obtener datos' });
        } else {
            res.json(results);
        }
    });
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en puerto ${port}`);
});

module.exports = app;