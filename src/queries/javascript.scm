; ES module imports
(import_statement
  source: (string (string_fragment) @import.source))

; require() calls
(call_expression
  function: (identifier) @_require
  arguments: (arguments (string (string_fragment) @import.source))
  (#eq? @_require "require"))

; Named class declarations (exported or not)
(class_declaration
  name: (identifier) @class.name)

; Exported class declarations
(export_statement
  declaration: (class_declaration
    name: (identifier) @class.name))

; Function declarations
(function_declaration
  name: (identifier) @function.name)

; Exported function declarations
(export_statement
  declaration: (function_declaration
    name: (identifier) @function.name))

; Arrow function assigned to const/let/var
(lexical_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function)))

(variable_declaration
  (variable_declarator
    name: (identifier) @function.name
    value: (arrow_function)))

; Exported arrow function
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @function.name
      value: (arrow_function))))

; Method definitions inside classes
(method_definition
  name: (property_identifier) @function.name)

; Call expressions — capture callee
(call_expression
  function: (identifier) @call.callee)

(call_expression
  function: (member_expression
    property: (property_identifier) @call.callee))
