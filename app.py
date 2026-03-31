import os
import uuid
import threading
import time
import zlib
from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from PIL import Image
import stego_core

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024
app.config['UPLOAD_FOLDER'] = 'uploads'

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# In-memory task store: task_id -> dict
tasks = {}

def get_file_extension(filename):
    if '.' in filename:
        return '.' + filename.rsplit('.', 1)[1].lower()
    return '.bin'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stats', methods=['POST'])
def get_stats():
    if 'cover_image' not in request.files:
        return jsonify({'error': 'No cover image provided'}), 400
        
    cover_image = request.files['cover_image']
    secret_file = request.files.get('secret_file')
    lsb_count = request.form.get('lsb_count', 1, type=int)

    try:
        img = Image.open(cover_image)
        width, height = img.size
        pixels_total = width * height
        max_bytes = stego_core.get_capacity(width, height, lsb_count)
        
        response = {
            'width': width,
            'height': height,
            'pixels': pixels_total,
            'capacity_bytes': max_bytes
        }
        
        if secret_file:
            secret_bytes_data = secret_file.read()
            size = len(secret_bytes_data)
            compressed_size = len(zlib.compress(secret_bytes_data, level=9))
            actual_embedded = min(size, compressed_size)  # matches stego_core logic
            response['secret_size_bytes'] = size
            response['compressed_size_bytes'] = compressed_size
            response['fits'] = actual_embedded < max_bytes
            
        return jsonify(response)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/encode', methods=['POST'])
def encode():
    cover_image = request.files.get('cover_image')
    secret_file = request.files.get('secret_file')
    password = request.form.get('password')
    lsb_count = request.form.get('lsb_count', 1, type=int)
    
    if not cover_image or not secret_file or not password:
        return jsonify({'error': 'Missing required fields'}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        'status': 'running', 'step': 1, 'step_name': 'Compressing your file',
        'percent': 0, 'error': None, 'result_path': None, 'started': time.time()
    }

    cover_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{task_id}_cover.png')
    cover_image.save(cover_path)
    secret_bytes = secret_file.read()
    ext = get_file_extension(secret_file.filename)
    out_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{task_id}_out.png')

    def run():
        try:
            def cb(step, name, pct):
                tasks[task_id].update({'step': step, 'step_name': name, 'percent': pct})
            stego_core.encode(cover_path, secret_bytes, ext, password, out_path, lsb_count, progress_callback=cb)
            tasks[task_id].update({'status': 'done', 'result_path': out_path, 'percent': 100})
        except Exception as e:
            tasks[task_id].update({'status': 'error', 'error': str(e)})

    threading.Thread(target=run, daemon=True).start()
    return jsonify({'task_id': task_id})

@app.route('/api/decode', methods=['POST'])
def decode():
    stego_image = request.files.get('stego_image')
    password = request.form.get('password')
    
    if not stego_image or not password:
        return jsonify({'error': 'Missing required fields'}), 400

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        'status': 'running', 'step': 1, 'step_name': 'Extracting from image',
        'percent': 0, 'error': None, 'result_path': None, 'ext': None, 'started': time.time()
    }

    stego_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{task_id}_stego.png')
    stego_image.save(stego_path)

    def run():
        try:
            def cb(step, name, pct):
                tasks[task_id].update({'step': step, 'step_name': name, 'percent': pct})
            secret_bytes, ext = stego_core.decode(stego_path, password, progress_callback=cb)
            out_path = os.path.join(app.config['UPLOAD_FOLDER'], f'{task_id}_decoded{ext}')
            with open(out_path, 'wb') as f:
                f.write(secret_bytes)
            tasks[task_id].update({'status': 'done', 'result_path': out_path, 'ext': ext, 'percent': 100})
        except Exception as e:
            tasks[task_id].update({'status': 'error', 'error': str(e)})

    threading.Thread(target=run, daemon=True).start()
    return jsonify({'task_id': task_id})

@app.route('/api/progress/<task_id>')
def progress(task_id):
    task = tasks.get(task_id)
    if not task:
        return jsonify({'error': 'Unknown task'}), 404
    elapsed = time.time() - task['started']
    pct = task['percent']
    eta = None
    if pct > 5:
        eta = round((elapsed / pct) * (100 - pct))
    return jsonify({
        'status': task['status'],
        'step': task['step'],
        'step_name': task['step_name'],
        'percent': pct,
        'eta_seconds': eta,
        'error': task['error'],
        'ext': task.get('ext')
    })

@app.route('/api/result/<task_id>')
def result(task_id):
    task = tasks.get(task_id)
    if not task or task['status'] != 'done':
        return jsonify({'error': 'Result not ready'}), 404
    path = task['result_path']
    ext = task.get('ext', '.png')
    name = f'secret_data{ext}' if ext != '.png' else 'encoded.png'
    return send_file(path, as_attachment=True, download_name=name)

if __name__ == '__main__':
    app.run(debug=True, port=5000)