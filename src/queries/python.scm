; Standard imports
(import_statement
  name: (dotted_name) @import.source)

; from X import Y
(import_from_statement
  module_name: (dotted_name) @import.source)

(import_from_statement
  module_name: (relative_import) @import.source)

; Class definitions
(class_definition
  name: (identifier) @class.name)

; Function definitions (top-level and methods)
(function_definition
  name: (identifier) @function.name)

; Call expressions
(call
  function: (identifier) @call.callee)

(call
  function: (attribute
    attribute: (identifier) @call.callee))
