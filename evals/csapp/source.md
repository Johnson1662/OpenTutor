# Computer Systems: A Programmer's Perspective (CSAPP) Core Architecture

Modern computer systems rely on hardware-software abstractions to provide performance, isolation, and concurrency.

## Memory Hierarchy
Computer systems organize storage into a hierarchy based on speed, cost, and capacity: CPU registers at the top (fastest, smallest), followed by L1/L2/L3 SRAM cache memory, DRAM main memory, and NVMe SSD / magnetic disk storage at the bottom. Higher levels act as staging areas (caches) for data stored in lower levels, exploiting temporal and spatial locality.

## Cache Memory
Caches are small, fast SRAM memory arrays situated between the CPU and main memory to bridge the CPU-memory performance gap. A cache is organized into $S = 2^s$ cache sets, each containing $E$ cache lines consisting of a valid bit, tag bits, and $B = 2^b$ bytes of block payload. When an address is requested, the hardware extracts set index, tag, and block offset to determine a cache hit or cache miss.

## Virtual Memory
Virtual Memory is an abstraction providing each process with a private, uniform address space while protecting memory against unauthorized access and sharing physical memory pages among multiple processes. It treats physical DRAM memory as a cache for disk-backed virtual address pages.

## Page Table
A page table is an in-memory data structure used by the hardware Memory Management Unit (MMU) to translate Virtual Page Numbers (VPN) to Physical Page Numbers (PPN). Multi-level page tables organize the page table into hierarchical tiers to drastically reduce the memory footprint required for sparse virtual address spaces. If a page table entry (PTE) has its valid bit cleared, accessing the address triggers a page fault exception.

## Translation Lookaside Buffer (TLB)
The Translation Lookaside Buffer (TLB) is a small, highly associative hardware cache inside the MMU that caches recent virtual-to-physical page translations (PTEs). A TLB hit avoids reading page table entries from L1/L2/L3 caches or main memory, reducing address translation latency to near-single-cycle speeds.

## System Call & Exceptions
An exception is an abrupt change in control flow in response to some event in processor state. Hardware exceptions are categorized into four classes: interrupts (asynchronous, external I/O), traps (synchronous intentional transfers, such as `syscall` instructions), faults (synchronous potentially recoverable errors, such as page faults), and aborts (unrecoverable hardware parity errors).

## Process vs Thread
A process is an operating system abstraction representing an instance of an executing program with its own dedicated private virtual address space and control flow. A thread is a fundamental unit of CPU execution within a process context that shares the process's address space, open file descriptors, and global variables, while maintaining its own private thread ID, stack, and register state.

## Socket Concurrency
Network server applications handle multiple client connections concurrently across transport-layer socket endpoints. Common concurrency models include process-based concurrency (`fork`), thread-based concurrency (worker threads / thread pools), and I/O multiplexing (`select`, `poll`, `epoll`), enabling high-throughput non-blocking request processing without thrashing system resources.
