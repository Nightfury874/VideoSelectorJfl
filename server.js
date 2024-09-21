// server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Define the port
const PORT = 3000;

// Directories
const dataDir = path.join(__dirname, 'data');
const videosDir = path.join(__dirname, 'videos');
const configPath = path.join(__dirname, 'config.json');
const publicDir = path.join(__dirname, 'public');

// Ensure necessary directories exist
[ dataDir, videosDir ].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Directory created at ${dir}`);
    } else {
        console.log(`Directory exists at ${dir}`);
    }
});

// Utility Functions

// Get current date in YYYY-MM-DD format
function getCurrentDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

// Get CSV file path based on current date
function getCSVFilePath() {
    return path.join(dataDir, `selections-${getCurrentDate()}.csv`);
}

// Initialize CSV file with headers if it doesn't exist
function initializeCSV(filePath) {
    if (!fs.existsSync(filePath)) {
        const headers = 'Timestamp,Response\n';
        fs.writeFileSync(filePath, headers, 'utf8');
        console.log(`CSV file created with headers: ${filePath}`);
    } else {
        console.log(`CSV file exists: ${filePath}`);
    }
}

// Load configuration from config.json
function loadConfig() {
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error reading config file:', err);
            return {};
        }
    }
    return {};
}

// Save configuration to config.json
function saveConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved:', config);
}

// Validate if video files are configured and exist
function validateVideos(config) {
    return config.video1 && config.video2 &&
           fs.existsSync(config.video1) && fs.existsSync(config.video2);
}

// Serve static files
function serveStaticFile(res, filePath, contentType, responseCode = 200) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error(`Error reading file ${filePath}:`, err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 - Internal Server Error');
        } else {
            res.writeHead(responseCode, { 'Content-Type': contentType });
            res.end(data);
        }
    });
}

// Serve video files with byte range support
function serveVideo(res, videoPath, req) {
    fs.stat(videoPath, (err, stats) => {
        if (err || !stats.isFile()) {
            console.error(`Video file not found: ${videoPath}`);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 - Video Not Found');
            return;
        }

        const range = req.headers.range;
        if (!range) {
            res.writeHead(416, { 'Content-Type': 'text/plain' });
            res.end('Range Not Satisfiable');
            return;
        }

        const positions = range.replace(/bytes=/, '').split('-');
        const start = parseInt(positions[0], 10);
        const total = stats.size;
        const end = positions[1] ? parseInt(positions[1], 10) : total - 1;
        const chunksize = (end - start) + 1;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4', // Adjust based on video type
        });

        const stream = fs.createReadStream(videoPath, { start, end })
            .on('open', () => stream.pipe(res))
            .on('error', (streamErr) => {
                console.error('Stream error:', streamErr);
                res.end(streamErr);
            });
    });
}

// Parse multipart/form-data
function parseMultipartFormData(req, callback) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.startsWith('multipart/form-data')) {
        callback(new Error('Invalid Content-Type'), null);
        return;
    }

    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
        callback(new Error('Missing boundary'), null);
        return;
    }

    const boundaryBuffer = Buffer.from(`--${boundary}`);
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const parts = buffer.split(boundaryBuffer).slice(1, -1); // Remove first and last boundary
        const files = {};

        parts.forEach(part => {
            const index = part.indexOf('\r\n\r\n');
            if (index !== -1) {
                const headers = part.slice(0, index).toString();
                const content = part.slice(index + 4, part.length - 2); // Remove trailing \r\n

                const dispositionMatch = headers.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/);
                if (dispositionMatch) {
                    const name = dispositionMatch[1];
                    const filename = dispositionMatch[2];
                    if (filename) {
                        files[name] = { filename, content };
                    }
                }
            }
        });

        callback(null, files);
    });

    req.on('error', (err) => {
        callback(err, null);
    });
}

// Buffer.prototype.split implementation
Buffer.prototype.split = function(separator) {
    let arr = [];
    let len = separator.length;
    let pos = 0;
    let index = this.indexOf(separator, pos);
    while (index !== -1) {
        arr.push(this.slice(pos, index));
        pos = index + len;
        index = this.indexOf(separator, pos);
    }
    arr.push(this.slice(pos));
    return arr;
};

// Process CSV and generate analytics data
function getAnalyticsData() {
    const currentCSVPath = getCSVFilePath();
    if (!fs.existsSync(currentCSVPath)) {
        return {
            totalSelections: 0,
            prototype1: 0,
            prototype2: 0,
            percentage1: 0,
            percentage2: 0,
            lastUpdated: 'Never',
            lastResponse: 'Never'
        };
    }

    const data = fs.readFileSync(currentCSVPath, 'utf8');
    const lines = data.trim().split('\n').slice(1); // Remove header

    let prototype1 = 0;
    let prototype2 = 0;
    let lastResponseTime = null;

    lines.forEach(line => {
        const [timestamp, response] = line.split(',');
        const cleanTimestamp = timestamp.replace(/"/g, '');
        const responseNumber = parseInt(response, 10);
        if (responseNumber === 1) prototype1++;
        else if (responseNumber === 2) prototype2++;

        if (!lastResponseTime || new Date(cleanTimestamp) > new Date(lastResponseTime)) {
            lastResponseTime = cleanTimestamp;
        }
    });

    const totalSelections = prototype1 + prototype2;
    const percentage1 = totalSelections > 0 ? ((prototype1 / totalSelections) * 100).toFixed(2) : 0;
    const percentage2 = totalSelections > 0 ? ((prototype2 / totalSelections) * 100).toFixed(2) : 0;
    const lastUpdated = new Date().toISOString();

    return {
        totalSelections,
        prototype1,
        prototype2,
        percentage1,
        percentage2,
        lastUpdated,
        lastResponse: lastResponseTime || 'Never'
    };
}

// Clear a directory asynchronously
function clearDirectory(directory, callback) {
    fs.readdir(directory, (err, files) => {
        if (err) {
            console.error(`Error reading directory ${directory}:`, err);
            callback(err);
            return;
        }

        if (files.length === 0) {
            callback(null);
            return;
        }

        let pending = files.length;
        let errors = [];

        files.forEach(file => {
            fs.unlink(path.join(directory, file), err => {
                if (err) {
                    console.error(`Error deleting file ${file}:`, err);
                    errors.push(err);
                }
                if (--pending === 0) {
                    callback(errors.length > 0 ? errors : null);
                }
            });
        });
    });
}

// Initialize today's CSV file on server start
initializeCSV(getCSVFilePath());

// Create the HTTP server
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const method = req.method;
    const pathname = parsedUrl.pathname;

    // Load current configuration
    const config = loadConfig();

    // Handle CORS preflight requests if necessary
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    if (method === 'GET') {
        switch (pathname) {
            case '/':
                serveStaticFile(res, path.join(publicDir, 'index.html'), 'text/html');
                break;
            case '/admin':
                serveStaticFile(res, path.join(publicDir, 'admin.html'), 'text/html');
                break;
            case '/config':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(config));
                break;
            case '/video1':
                if (validateVideos(config)) {
                    serveVideo(res, config.video1, req);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Video not configured');
                }
                break;
            case '/video2':
                if (validateVideos(config)) {
                    serveVideo(res, config.video2, req);
                } else {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Video not configured');
                }
                break;
            case '/analytics':
                serveStaticFile(res, path.join(publicDir, 'analytics.html'), 'text/html');
                break;
            case '/analytics/data':
                const analyticsData = getAnalyticsData();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(analyticsData));
                break;
            default:
                // Serve static files from public directory
                let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
                const extname = String(path.extname(filePath)).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html',
                    '.css': 'text/css',
                    '.js': 'application/javascript',
                    '.png': 'image/png',
                    '.jpg': 'image/jpg',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.json': 'application/json',
                    '.wav': 'audio/wav',
                    '.mp4': 'video/mp4',
                    '.woff': 'application/font-woff',
                    '.ttf': 'application/font-ttf',
                    '.eot': 'application/vnd.ms-fontobject',
                    '.otf': 'application/font-otf',
                    '.wasm': 'application/wasm'
                };

                const contentType = mimeTypes[extname] || 'application/octet-stream';
                fs.access(filePath, fs.constants.F_OK, (err) => {
                    if (!err) {
                        serveStaticFile(res, filePath, contentType);
                    } else {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('404 - Not Found');
                    }
                });
                break;
        }
    } else if (method === 'POST') {
        if (pathname === '/select') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const { response, timestamp } = data;

                    if (response === undefined || !timestamp) {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('400 - Bad Request: Missing response or timestamp');
                        return;
                    }

                    const currentCSVPath = getCSVFilePath();
                    initializeCSV(currentCSVPath);

                    const csvLine = `"${timestamp}",${response}\n`;
                    fs.appendFile(currentCSVPath, csvLine, (err) => {
                        if (err) {
                            console.error('Error writing to CSV:', err);
                            res.writeHead(500, { 'Content-Type': 'text/plain' });
                            res.end('500 - Internal Server Error');
                        } else {
                            console.log(`Recorded selection: Response ${response} at ${timestamp} in ${currentCSVPath}`);
                            res.writeHead(200, { 'Content-Type': 'text/plain' });
                            res.end('Selection recorded');
                        }
                    });
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('400 - Bad Request: Invalid JSON');
                }
            });
        } else if (pathname === '/admin/upload') {
            parseMultipartFormData(req, (err, files) => {
                if (err) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(`400 - Bad Request: ${err.message}`);
                    return;
                }

                const videoFields = ['video1', 'video2'];
                let configUpdate = false;
                let uploadErrors = [];

                videoFields.forEach(field => {
                    if (files[field]) {
                        const file = files[field];
                        const ext = path.extname(file.filename).toLowerCase();
                        const allowedExt = ['.mp4', '.webm', '.ogg'];

                        if (!allowedExt.includes(ext)) {
                            uploadErrors.push(`Invalid file type for ${field}. Allowed types: ${allowedExt.join(', ')}`);
                            return;
                        }

                        const savePath = path.join(videosDir, `${field}${ext}`);
                        try {
                            fs.writeFileSync(savePath, file.content);
                            config[field] = savePath;
                            console.log(`Saved ${field} to ${savePath}`);
                            configUpdate = true;
                        } catch (err) {
                            console.error(`Error saving file ${savePath}:`, err);
                            uploadErrors.push(`Error saving ${field}`);
                        }
                    }
                });

                if (uploadErrors.length > 0) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(`400 - Bad Request: ${uploadErrors.join('; ')}`);
                    return;
                }

                if (configUpdate) {
                    saveConfig(config);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Configuration saved');
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('400 - Bad Request: No valid files uploaded');
                }
            });
        } else if (pathname === '/admin/clear') {
            const clearVideos = () => new Promise((resolve, reject) => {
                clearDirectory(videosDir, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            const clearData = () => new Promise((resolve, reject) => {
                clearDirectory(dataDir, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            const clearConfig = () => new Promise((resolve, reject) => {
                fs.writeFile(configPath, '{}', 'utf8', (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            Promise.all([clearVideos(), clearData(), clearConfig()])
                .then(() => {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Videos and configuration cleared successfully');
                })
                .catch((errors) => {
                    console.error('Error clearing resources:', errors);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('500 - Internal Server Error: Failed to clear resources');
                });
        } else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('405 - Method Not Allowed');
        }
    } else {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('405 - Method Not Allowed');
    }
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
