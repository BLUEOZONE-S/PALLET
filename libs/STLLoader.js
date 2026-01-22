/**
 * @author mrdoob / http://mrdoob.com/
 * @author bena / http://www.paulbrunt.co.uk/
 * @author kgedwell / https://github.com/kgedwell
 * @author OpenAI - trimmed local copy for single-file app usage.
 */
(function () {
  if (typeof THREE === 'undefined') {
    console.error('THREE is required for STLLoader.');
    return;
  }

  THREE.STLLoader = function (manager) {
    this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;
  };

  THREE.STLLoader.prototype = {
    constructor: THREE.STLLoader,

    load: function (url, onLoad, onProgress, onError) {
      var loader = new THREE.FileLoader(this.manager);
      loader.setResponseType('arraybuffer');
      loader.load(url, function (buffer) {
        try {
          onLoad(this.parse(buffer));
        } catch (e) {
          if (onError) onError(e);
        }
      }.bind(this), onProgress, onError);
    },

    parse: function (data) {
      function isBinary(data) {
        var reader = new DataView(data);
        var faceSize = (32 / 8 * 3) + ((32 / 8 * 3) * 3) + (16 / 8);
        var nFaces = reader.getUint32(80, true);
        var expect = 84 + (faceSize * nFaces);
        if (expect === reader.byteLength) return true;
        var solid = 0;
        for (var i = 0; i < 5; i++) {
          solid += reader.getUint8(i);
        }
        return solid !== 0;
      }

      function parseBinary(data) {
        var reader = new DataView(data);
        var faces = reader.getUint32(80, true);
        var vertices = new Float32Array(faces * 9);
        var normals = new Float32Array(faces * 9);
        var offset = 84;
        for (var face = 0; face < faces; face++) {
          var normalX = reader.getFloat32(offset, true); offset += 4;
          var normalY = reader.getFloat32(offset, true); offset += 4;
          var normalZ = reader.getFloat32(offset, true); offset += 4;
          for (var i = 0; i < 3; i++) {
            var vx = reader.getFloat32(offset, true); offset += 4;
            var vy = reader.getFloat32(offset, true); offset += 4;
            var vz = reader.getFloat32(offset, true); offset += 4;
            var idx = (face * 9) + (i * 3);
            vertices[idx] = vx;
            vertices[idx + 1] = vy;
            vertices[idx + 2] = vz;
            normals[idx] = normalX;
            normals[idx + 1] = normalY;
            normals[idx + 2] = normalZ;
          }
          offset += 2;
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        return geometry;
      }

      function parseASCII(data) {
        var geometry = new THREE.BufferGeometry();
        var vertices = [];
        var normals = [];
        var patternNormal = /facet\s+normal\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
        var patternVertex = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;
        var result;
        while ((result = patternNormal.exec(data)) !== null) {
          var normal = [parseFloat(result[1]), parseFloat(result[2]), parseFloat(result[3])];
          for (var i = 0; i < 3; i++) {
            result = patternVertex.exec(data);
            vertices.push(parseFloat(result[1]), parseFloat(result[2]), parseFloat(result[3]));
            normals.push(normal[0], normal[1], normal[2]);
          }
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        return geometry;
      }

      if (typeof data === 'string') return parseASCII(data);
      return isBinary(data) ? parseBinary(data) : parseASCII(new TextDecoder().decode(new Uint8Array(data)));
    }
  };
})();
