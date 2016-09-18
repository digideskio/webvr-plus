# WebVR Plus
Wrapper around the WebVR API to provide useful, frequently used variants of the
data.

Adds these new properties of functions:

* VRFrameData
  * headMatrix
  * leftEyeMatrix
  * rightEyeMatrix
  * transform

* VRDisplay
  * getStandingFrameData()
  * get3DoFFrameData()
  * getMono3DoFFrameData()

Currently depends on [glMatrix](http://glmatrix.net)
