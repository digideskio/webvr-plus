/*
Copyright (c) 2016, Brandon Jones.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/*
Patches some useful convenience functions into WebVR to handle commonly needed
scenarios.
*/
(function() {
  if (!('VRFrameData' in window) || !('VRDisplay' in window)) {
    // Don't patch what isn't there.
    return;
  }

  "use strict";

  //
  // Cached matrices and vectors for great speediness of the maths.
  //

  var defaultPoseOrientation = new Float32Array([0, 0, 0, 1]);
  var defaultPosePosition = new Float32Array([0, 0, 0]);

  var translateVector = new Float32Array(3);
  var transformMatrix = new Float32Array(16);
  var invMatrix = new Float32Array(16);
  var rotMatrix = new Float32Array(9);
  var quatMatrix = new Float32Array(9);

  //
  // VRFrameData
  //

  VRFrameData.prototype.__headMatrix = null;
  VRFrameData.prototype.__headMatrixDirty = true;

  VRFrameData.prototype.__leftEyeMatrix = null;
  VRFrameData.prototype.__leftEyeMatrixDirty = true;

  VRFrameData.prototype.__rightEyeMatrix = null;
  VRFrameData.prototype.__rightEyeMatrixDirty = true;

  VRFrameData.prototype.__markDirty = function() {
    this.__headMatrixDirty = true;
    this.__leftEyeMatrixDirty = true;
    this.__rightEyeMatrixDirty = true;
  };

  Object.defineProperty(VRFrameData.prototype, 'headMatrix', {
    get: function() {
      if (!this.__headMatrixDirty)
        return this.__headMatrix;

      this.__headMatrixDirty = false;

      if (!this.__headMatrix)
        this.__headMatrix = new Float32Array(16);

      mat4.fromRotationTranslation(this.__headMatrix,
          this.pose.orientation || defaultPoseOrientation,
          this.pose.position || defaultPosePosition);

      return this.__headMatrix;
    },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(VRFrameData.prototype, 'leftEyeMatrix', {
    get: function() {
      if (!this.__leftEyeMatrixDirty)
        return this.__leftEyeMatrix;

      this.__leftEyeMatrixDirty = false;

      if (!this.__leftEyeMatrix)
        this.__leftEyeMatrix = new Float32Array(16);

      mat4.invert(this.__leftEyeMatrix, this.leftViewMatrix);

      return this.__leftEyeMatrix;
    },
    configurable: true,
    enumerable: true
  });

  Object.defineProperty(VRFrameData.prototype, 'rightEyeMatrix', {
    get: function() {
      if (!this.__rightEyeMatrixDirty)
        return this.__rightEyeMatrix;

      this.__rightEyeMatrixDirty = false;

      if (!this.__rightEyeMatrix)
        this.__rightEyeMatrix = new Float32Array(16);

      mat4.invert(this.__rightEyeMatrix, this.rightViewMatrix);

      return this.__rightEyeMatrix;
    },
    configurable: true,
    enumerable: true
  });

  window.VRFrameData.prototype.transformPose = function(matrix) {
    this.__markDirty();

    // Transform the pose
    if (this.pose.position) {
      vec3.transformMat4(this.pose.position, this.pose.position, matrix);
    }

    if (this.pose.orientation || this.pose.linearVelocity || this.pose.linearAcceleration) {
      mat3.fromMat4(rotMatrix, matrix);

      if (this.pose.orientation) {
        mat3.fromQuat(quatMatrix, this.pose.orientation);
        mat3.multiply(quatMatrix, quatMatrix, rotMatrix);
        quat.fromMat3(this.pose.orientation, quatMatrix);
        quat.normalize(this.pose.orientation, this.pose.orientation);
      }

      if (this.pose.velocity) {
        vec3.transformMat3(this.pose.linearVelocity, this.pose.linearVelocity, rotMatrix);
      }

      if (this.pose.acceleration) {
        vec3.transformMat3(this.pose.linearAcceleration, this.pose.linearAcceleration, rotMatrix);
      }
    }

    // TODO: angularVelocity, angularAcceleration
  }

  // Faster than calling transform if all you want is the view matrices
  window.VRFrameData.prototype.transformView = function(matrix) {
    this.__markDirty();

    // Transform the view matrices
    mat4.invert(invMatrix, matrix);
    mat4.multiply(this.leftViewMatrix, this.leftViewMatrix, invMatrix);
    mat4.multiply(this.rightViewMatrix, this.rightViewMatrix, invMatrix);
  }

  window.VRFrameData.prototype.transform = function(matrix) {
    this.transformPose(matrix);
    this.transformView(matrix);
  }

  //
  // VRDisplay
  //

  var origGetFrameData = VRDisplay.prototype.getFrameData;
  
  VRDisplay.prototype.getFrameData = function(frameData) {
    if (!origGetFrameData.call(this, frameData))
      return false;

    frameData.__markDirty();
    return true;
  }

  // Gets the frameData in standing space, using the sittingToStandingTransform
  // if available or a provided default user height if not.
  VRDisplay.prototype.getStandingFrameData = function(frameData, defaultHeight) {
    if (!this.getFrameData(frameData))
      return false;

    if (this.stageParameters) {
      frameData.transform(this.stageParameters.sittingToStandingTransform);
    } else {
      if (!defaultHeight)
        defaultHeight = 1.65; // Average height of a human being. (~5.4ft)

      vec3.set(translateVector, 0, defaultHeight, 0);
      mat4.fromTranslation(transformMatrix, translateVector);
      frameData.transform(transformMatrix);
    }

    return true;
  }

  // Gets frame data with the positional component stripped away.
  VRDisplay.prototype.get3DoFFrameData = function(frameData) {
    if (!this.getFrameData(frameData))
      return false;

    // Already 3DoF? Nothing more to do!
    if (!frameData.pose.position)
      return true;

    // Transform the view matrix by the positional transform to negate it
    // (Since you would normally transform by the inverse matrix this does the
    // trick with far less math.)
    mat4.fromTranslation(invMatrix, frameData.pose.position);
    mat4.multiply(frameData.leftViewMatrix, frameData.leftViewMatrix, invMatrix);
    mat4.multiply(frameData.rightViewMatrix, frameData.rightViewMatrix, invMatrix);

    vec3.set(frameData.pose.position, 0, 0, 0);

    return true;
  }

  // Gets frame data with the positional component stripped away and no eye
  // offsets. Useful for photospheres or 360 movies.
  VRDisplay.prototype.getMono3DoFFrameData = function(frameData) {
    if (!this.getFrameData(frameData))
      return false;

    // TODO: If the view matricies have any rotational component this will
    // give he wrong result.

    mat4.fromQuat(frameData.leftViewMatrix, frameData.pose.orientation || defaultPoseOrientation);
    mat4.invert(frameData.leftViewMatrix, frameData.leftViewMatrix);

    mat4.copy(frameData.rightViewMatrix, frameData.leftViewMatrix);

    if (frameData.pose.position)
      vec3.set(frameData.pose.position, 0, 0, 0);

    return true;
  }

  //
  // TODOs: Features I'd like to add
  //

  // * VRFrameData
  //   * HeadToEyeLeft/RightMatrix (tranform from head matrix to eye matrix)

  // * VRDisplay
  //   * Derive field of view from projection matrix (since fieldOfView is deprecated)

  // * Gamepads
  //   * Automatically finding associated gamepads
  //   * Getting transform matrices for gamepads
  //   * Getting gamepads in standing space
  //   * Generation of picking rays
  //   * Elbow model for 3DoF controllers
})();
