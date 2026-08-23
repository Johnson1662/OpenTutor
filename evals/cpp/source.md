# Modern C++ Systems Programming

Modern C++ provides zero-overhead abstractions, deterministic resource management, and value semantics for high-performance software systems.

## Pointers and References
Pointers (`T*`) are variables holding the memory address of an object, capable of being null and being reseated to point to different memory addresses throughout their lifetime. References (`T&`) are immutable aliases for existing objects that must be bound upon initialization, cannot be null, and cannot be reseated.

## RAII & Resource Ownership
Resource Acquisition Is Initialization (RAII) is a C++ idiom where resource allocation (heap memory, file handles, mutex locks, network sockets) is tied to object lifetime. The resource is acquired during construction and deterministically released in the destructor when the object goes out of scope, guaranteeing exception safety without manual cleanup blocks.

## Copy vs Move Semantics
Copy semantics duplicate an object's state and underlying heap allocations via copy constructors (`T(const T&)`) and copy assignment operators (`T& operator=(const T&)`). Move semantics transfer ownership of dynamic resources from temporary (rvalue) objects via move constructors (`T(T&&)`) and move assignment operators (`T& operator=(T&&)`), avoiding deep copying and expensive memory reallocation.

## std::move & Rvalue References
Rvalue references (`T&&`) bind specifically to temporary objects or expressions whose resources can be safely stolen. `std::move` is an unconditional static cast that converts an expression to an rvalue reference type (`static_cast<std::remove_reference_t<T>&&>(val)`). `std::move` itself does not move any memory or execute code at runtime; it merely enables move overload resolution.

## Smart Pointers
Modern C++ replaces raw owning pointers with standard library smart pointer classes in `<memory>`:
- `std::unique_ptr<T>`: Represents exclusive, non-copyable ownership of a heap resource with zero runtime overhead over a raw pointer.
- `std::shared_ptr<T>`: Implements shared ownership using a thread-safe atomic reference counter.
- `std::weak_ptr<T>`: Holds a non-owning observer reference to a `std::shared_ptr` managed object to break reference cycles.

## Template Metaprogramming
Template Metaprogramming (TMP) is a compile-time computation technique using C++ templates to generate specialized types, perform static type introspection (type traits, SFINAE, and C++20 Concepts), and compute constants at compile time before runtime execution begins.
