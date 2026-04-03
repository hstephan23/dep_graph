import os
import re
import hashlib
import tempfile
import zipfile
import shutil
from werkzeug.utils import secure_filename
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder='static')

def get_color(filepath):
    # Use the directory name to ensure files in the same directory have the same color
    dirname = os.path.dirname(filepath)
    if not dirname:
        dirname = "."
    
    palette = [
        "#4E79A7", "#F28E2C", "#E15759", "#76B7B2", "#59A14F",
        "#EDC949", "#AF7AA1", "#FF9DA7", "#9C755F", "#BAB0AB",
        "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
        "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF"
    ]
    hash_val = int(hashlib.md5(dirname.encode('utf-8')).hexdigest(), 16)
    return palette[hash_val % len(palette)]

def parse_c_files(directory, hide_system=False, show_c=True, show_h=True, show_cpp=True, hide_isolated=False, filter_dir=""):
    nodes = []
    edges = []
    
    include_pattern = re.compile(r'#include\s*(<|")([^>"]+)(>|")')
    
    files_to_parse = []
    for root, dirs, files in os.walk(directory):
        # Exclude common test and cmake directories
        dirs[:] = [d for d in dirs if not (
            d.lower().startswith('test') or 'test' in d.lower() or
            'cmake' in d.lower()
        )]
        
        for file in files:
            # Exclude test and cmake files
            if 'test' in file.lower() or 'cmake' in file.lower():
                continue
            if (file.endswith('.c') and show_c) or (file.endswith('.h') and show_h) or (file.endswith(('.cpp', '.cc', '.cxx', '.hpp', '.hxx')) and show_cpp):
                files_to_parse.append(os.path.join(root, file))
                
    node_set = set()
    
    for filepath in files_to_parse:
        filename = os.path.relpath(filepath, directory)
        if filename not in node_set:
            nodes.append({"data": {"id": filename, "color": get_color(filename)}})
            node_set.add(filename)
            
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                match = include_pattern.search(line)
                if match:
                    is_system = match.group(1) == '<'
                    if hide_system and is_system:
                        continue
                        
                    included_file = match.group(2)
                    if (included_file.endswith('.c') and not show_c) or (included_file.endswith('.h') and not show_h) or (included_file.endswith(('.cpp', '.cc', '.cxx', '.hpp', '.hxx')) and not show_cpp):
                        continue
                        
                    edges.append({"data": {"source": filename, "target": included_file, "color": get_color(filename)}})
                    
                    if included_file not in node_set:
                        nodes.append({"data": {"id": included_file, "color": get_color(included_file)}})
                        node_set.add(included_file)
                        
    # Find Strongly Connected Components (SCCs) to detect cycles
    adj = {node["data"]["id"]: [] for node in nodes}
    for edge in edges:
        u = edge["data"]["source"]
        v = edge["data"]["target"]
        if u not in adj:
            adj[u] = []
        adj[u].append(v)

    index = 0
    stack = []
    indices = {}
    lowlinks = {}
    on_stack = set()
    sccs = []

    def strongconnect(v):
        nonlocal index
        indices[v] = index
        lowlinks[v] = index
        index += 1
        stack.append(v)
        on_stack.add(v)

        for w in adj.get(v, []):
            if w not in indices:
                strongconnect(w)
                lowlinks[v] = min(lowlinks[v], lowlinks[w])
            elif w in on_stack:
                lowlinks[v] = min(lowlinks[v], indices[w])

        if lowlinks[v] == indices[v]:
            scc = []
            while True:
                w = stack.pop()
                on_stack.remove(w)
                scc.append(w)
                if w == v:
                    break
            sccs.append(scc)

    for v in adj:
        if v not in indices:
            strongconnect(v)

    # Any edge (u, v) where u and v are in the same SCC of size > 1 is part of a cycle
    # Also self-loops (size 1 but u == v)
    cycle_nodes = set()
    cycles_list = []
    for scc in sccs:
        if len(scc) > 1:
            cycle_nodes.update(scc)
            cycles_list.append(scc)

    cycle_edges = []
    for edge in edges:
        u = edge["data"]["source"]
        v = edge["data"]["target"]
        if u == v:
            edge["classes"] = "cycle"
            cycle_edges.append(edge)
            if [u] not in cycles_list:
                cycles_list.append([u])
        elif (u in cycle_nodes and v in cycle_nodes and any(u in scc and v in scc for scc in sccs if len(scc) > 1)):
            edge["classes"] = "cycle"
            cycle_edges.append(edge)

    in_degrees = {node["data"]["id"]: 0 for node in nodes}
    for edge in edges:
        target = edge["data"]["target"]
        if target in in_degrees:
            in_degrees[target] += 1

    for node in nodes:
        node["data"]["size"] = 80 + (in_degrees[node["data"]["id"]] * 40)

    if hide_isolated:
        connected_nodes = set()
        for edge in edges:
            connected_nodes.add(edge["data"]["source"])
            connected_nodes.add(edge["data"]["target"])
        nodes = [node for node in nodes if node["data"]["id"] in connected_nodes]

    if filter_dir:
        nodes = [node for node in nodes if node["data"]["id"].startswith(filter_dir)]
        valid_node_ids = {node["data"]["id"] for node in nodes}
        edges = [edge for edge in edges if edge["data"]["source"] in valid_node_ids and edge["data"]["target"] in valid_node_ids]

    return {"nodes": nodes, "edges": edges, "has_cycles": len(cycle_edges) > 0, "cycles": cycles_list}

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/api/graph', methods=['GET'])
def get_graph():
    directory = request.args.get('dir', '.')
    hide_system = request.args.get('hide_system', 'false').lower() == 'true'
    show_c = request.args.get('show_c', 'true').lower() == 'true'
    show_h = request.args.get('show_h', 'true').lower() == 'true'
    show_cpp = request.args.get('show_cpp', 'true').lower() == 'true'
    hide_isolated = request.args.get('hide_isolated', 'false').lower() == 'true'
    filter_dir = request.args.get('filter_dir', '')
    graph_data = parse_c_files(directory, hide_system=hide_system, show_c=show_c, show_h=show_h, show_cpp=show_cpp, hide_isolated=hide_isolated, filter_dir=filter_dir)
    return jsonify(graph_data)

@app.route('/api/upload', methods=['POST'])
def upload_files():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    if not (file.filename.endswith('.zip') or file.filename.endswith(('.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx'))):
        return jsonify({"error": "Unsupported file type. Please upload a ZIP or C/C++ source file."}), 400
        
    hide_system = request.form.get('hide_system', 'false').lower() == 'true'
    show_c = request.form.get('show_c', 'true').lower() == 'true'
    show_h = request.form.get('show_h', 'true').lower() == 'true'
    show_cpp = request.form.get('show_cpp', 'true').lower() == 'true'
    hide_isolated = request.form.get('hide_isolated', 'false').lower() == 'true'
    filter_dir = request.form.get('filter_dir', '')

    temp_dir = tempfile.mkdtemp()
    try:
        zip_path = os.path.join(temp_dir, secure_filename(file.filename))
        file.save(zip_path)
        
        if zip_path.endswith('.zip'):
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            
        graph_data = parse_c_files(temp_dir, hide_system=hide_system, show_c=show_c, show_h=show_h, show_cpp=show_cpp, hide_isolated=hide_isolated, filter_dir=filter_dir)
        return jsonify(graph_data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(temp_dir)

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=8080)
