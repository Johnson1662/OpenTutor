# Transformer Architecture

The Transformer architecture is a sequence transduction model that relies entirely on attention mechanisms to draw global dependencies between input and output representations without recurrent or convolutional neural networks.

## Positional Encoding
Because Transformer models contain no recurrence and no convolution, they cannot inherently distinguish the order of tokens in a sequence. To inject sequence order, positional encodings are added to the input embeddings at the bottoms of the encoder and decoder stacks. These encodings use sine and cosine functions of different frequencies or learned embeddings to represent absolute and relative token positions.

## Query, Key, and Value (Q/K/V) Projections
For each token representation, linear projection layers compute three distinct vectors: Query (Q), Key (K), and Value (V). The query represents what the current token is looking for, the key acts as an address or label that matches queries, and the value contains the content information to be aggregated.

## Softmax Normalization
The dot products between query and key vectors produce attention logits representing compatibility scores. These raw logits are divided by the square root of the key dimension ($ \sqrt{d_k} $) to prevent vanishing gradients during training, and then transformed by the softmax function. Softmax converts the logits into a probability distribution where all weights sum to 1.

## Self-Attention
Self-attention (also known as intra-attention) relates different positions of a single sequence to compute a representation of the sequence. The attention output is calculated as a weighted sum of the Value vectors, where each weight is assigned by the softmax normalization over the dot products between the Query and corresponding Key vectors:
$$ \text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V $$

## Multi-Head Attention
Instead of performing a single attention function with $d_{\text{model}}$-dimensional queries, keys, and values, Multi-Head Attention linearly projects queries, keys, and values $h$ times with different learned linear projections to lower dimensions. The attention mechanism is applied to each projected version in parallel. The resulting $h$ head outputs are concatenated and projected once more to yield the final representation, allowing the model to jointly attend to information from different representation subspaces.

## Residual Connections
Every sub-layer in the encoder and decoder (including multi-head attention and feed-forward networks) is wrapped with a residual connection (skip connection). The operation computes $\text{LayerNorm}(x + \text{SubLayer}(x))$. Residual connections facilitate gradient propagation through deep networks and prevent vanishing gradient degradation.

## Layer Normalization
Layer Normalization normalizes the activations across features for each training example independently. Unlike batch normalization, layer normalization computes mean and variance statistics over the hidden dimension of each token at a specific time step, providing stable and invariant training dynamics across varying batch sizes and sequence lengths.

## Feed-Forward Network (FFN)
Each attention layer in the encoder and decoder is followed by a fully connected feed-forward network applied to each position separately and identically. The FFN consists of two linear transformations with a non-linear activation function (such as ReLU or GeLU) in between:
$$ \text{FFN}(x) = \max(0, xW_1 + b_1)W_2 + b_2 $$
This sub-layer projects token representations into a higher-dimensional space and back to introduce non-linear expressiveness.
